/**
 * Following the subject, pressed through and LOOKED AT in the running page
 * (docs/CLIPS.md §4.9's harness check; §15 row 5).
 *
 *   await window.__forgeReframeCheck()   → the report, or throws with every failure
 *
 * Against the bridge's deterministic stub (harness/reframeStub.ts): the
 * analysis "finds", in a 640×360 video, shots at 0–2 / 2–4 / 4–6 s with one
 * face at x 0.25, then one at 0.75, then two at 0.35 and 0.65 — too far apart
 * for the 202 px crop a 9:16 canvas cuts from 360 px, so the third shot is a
 * stacked two-up. Detection is not here (the integration tests' job); what is
 * here is everything after it, and all of that is renderer logic:
 *
 *   1. The talk on a 9:16 canvas, its clip selected; the dock reads "Follow
 *      the subject · gets the face finder, 1.1 MB, first time". The press
 *      fetches the face finder, runs the stub job, and the track lands in ONE
 *      undo step.
 *   2. The crops are where the faces are (each single crop's centre on its
 *      face, the halves' on theirs, the left face on top) — from the stub's
 *      numbers, not from the code under test.
 *   3. Paused, at a frame inside each shot and on each side of every cut, the
 *      Output canvas against the element's own frame drawn through the
 *      expected crop — through the two expected halves, stacked, in the third
 *      shot. Mean difference ≤ 2/255; and the WRONG picture (the other side's
 *      crop at a cut, the one crop instead of the stack) must differ, or the
 *      compare could not have told.
 *   4. The Source outline in the third shot shows two rectangles: a point in
 *      the bottom half's rectangle and outside the one crop is lit, a point in
 *      the one crop and outside both halves is dimmed.
 *   5. PLAYING (§15 row 5), twice — as it plays, then with the element
 *      nudged 3 frames ahead through the first cut and 3 behind through the
 *      second (inside the 0.18 s the preview tolerates): every frame the
 *      element presents, its drift against the playhead, and around each cut
 *      which crop the preview drew — the element's frame's (`exportFrameAt`
 *      on its presented mediaTime) or the playhead's. Where the two differ it
 *      must be the element's.
 *   6. 9:16 → 16:9 → 9:16 on the canvas bar's own buttons: the clip still
 *      follows, and the crops come back exactly.
 *   7. A drag on the second shot's rectangle on the Source outline (Reframe
 *      on, Split): its offset kept under its startMs, its crop moved by the
 *      drag, the other shots not; one undo step.
 *   8. A drag in the lower half of the two-up's picture on the Output side
 *      of the split: only the bottom half moves; one undo step.
 *
 * The page's synthetic pointers are not active pointers, so
 * `setPointerCapture` is a no-op during a drag here (`dragAt` says why).
 *   9. The dragged two-up on the Output (its halves, not the stack before the
 *      drag), then Stack two people off, in the dock: one crop, on the larger
 *      face (equal faces: the left one), and not the stack it replaced.
 *  10. Undo, step by step, back to before the follow: each step restores the
 *      one before it, and the follow itself goes in one.
 *
 * Run it in the FRONTED tab on a freshly loaded page: it records its video
 * with requestAnimationFrame and waits for React with animation frames, which
 * a background tab never runs. It leaves the project it built on screen, and
 * clears the stub's finished analyses off EXPORT's list.
 */

import { clipEnd, framesToSeconds, sourceFrameFor, type Clip, type CropRect, type MediaAsset } from '@shared/timeline'
import { cropAt, type CropOnFrame } from '@shared/render/crop'
import { exportFrameAt, followKeys, type FollowKeys } from '@shared/reframe/keys'
import { clipBox } from '@shared/render/plan'
import { ASPECTS } from '@shared/render/aspect'
import { HARNESS_FACE_CENTRES, HARNESS_SHOT_STARTS } from './reframeStub'
import { harnessReframe, recordColumnsVideo } from './bridge'
import { useEditor } from '../store'
import { outputFrame } from '../components/Preview'

/* ---------------------------------------------------------------- report */

interface Compare {
  frame: number
  /** Mean |Output − the element's frame through the expected crop|, 0..255 over RGB. */
  diff: number
  /** The same against the picture that would be WRONG here. */
  wrong: number
  stacked: boolean
}

interface PlayedFrame {
  /** The element's presented frame's media time, s. */
  mediaTime: number
  /** The clip frame the export shows that moment on: exportFrameAt(mediaTime). */
  elementFrame: number
  /** The store's playhead, as a clip frame, when the frame was read. */
  playheadFrame: number
}

interface NearCut extends PlayedFrame {
  cut: number
  /** Against the crop at the element's frame, and at the playhead's. Equal crops are one compare. */
  diffElement: number
  diffPlayhead: number
  /** Which crop the preview drew, when the two differ. */
  drew: 'element' | 'playhead' | 'same' | 'neither'
}

export interface PlayPass {
  /** Frames the element presented, each read once the preview had painted. */
  frames: number
  /** Playhead's clip frame − the element's, over every presented frame. */
  drift: { min: number; max: number; mean: number }
  nearCuts: NearCut[]
  /** Of the near-cut frames whose two crops differ: how many the preview drew at the element's frame. */
  elementHeld: number
  differing: number
  /** Every presented frame's drift, in order, and where the nudges landed: to read a pass back by. */
  drifts: number[]
  nudgedAt: number[]
  /** The element was still playing after the playhead stopped (Scrub on, a clip with no sound — see playThrough). */
  stillPlaying: boolean
}

export interface ReframeCheckReport {
  setup: { assetId: string; clipId: string; fps: number; source: { width: number; height: number }; video: string } | null
  follow: {
    labelBefore: string
    fetched: boolean
    jobs: number
    undoSteps: number
    ms: number
  } | null
  /** Each shot's crop from the compiled keys, at a frame inside it, and where the stub's faces say it should be. */
  shots: {
    index: number
    startMs: number
    from: number
    to: number
    why: string
    crop: CropRect
    halves: { top: CropRect; bottom: CropRect } | null
    centres: number[]
    faces: number[]
  }[]
  paused: Compare[]
  cuts: { cut: number; before: Compare; at: Compare }[]
  outline: { probes: { name: string; ratio: number; want: 'lit' | 'dim' }[] } | null
  playing: { natural: PlayPass; nudged: PlayPass } | null
  roundTrip: { at169: { follows: boolean; note: string | null }; back: boolean; crops: CropRect[] } | null
  drag: { shot: number; share: number | null; moved: number; others: boolean; undoSteps: number } | null
  dragHalf: { share: { x: number; y: number } | null; bottomMoved: number; topMoved: number; undoSteps: number } | null
  stackOff: { before: Compare; twoUp: boolean | undefined; halves: boolean; centre: number; compare: Compare } | null
  undo: { steps: string[]; unfollowed: boolean } | null
  failures: string[]
  ms: number
}

/* ---------------------------------------------------------------- waiting */

const editor = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

async function frames(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('reframe check: requestAnimationFrame did not fire in 3 s — bring the harness tab to the front')),
          3000
        )
        requestAnimationFrame(() => resolve())
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

async function until<T>(test: () => T | null | undefined | false, ms: number, what: string): Promise<T> {
  const stop = performance.now() + ms
  for (;;) {
    const value = test()
    if (value) return value
    if (performance.now() > stop) throw new Error(`reframe check: ${what} did not happen in ${ms / 1000} s`)
    await frames(1)
  }
}

/* ---------------------------------------------------------------- the DOM */

function previewCanvas(): HTMLCanvasElement {
  const found = document.querySelectorAll<HTMLCanvasElement>('canvas[data-forge-preview="1"]')
  if (found.length !== 1) throw new Error(`reframe check: expected one preview canvas, found ${found.length}`)
  return found[0]
}

/** The preview's box, in CSS px: the canvas fills it. */
function previewBox(): { width: number; height: number; dpr: number } {
  const canvas = previewCanvas()
  const dpr = window.devicePixelRatio || 1
  return { width: canvas.width / dpr, height: canvas.height / dpr, dpr }
}

function videoFor(asset: MediaAsset): HTMLVideoElement {
  const found = [...document.querySelectorAll('video')].filter((v) => v.src === asset.path)
  if (found.length !== 1) throw new Error(`reframe check: expected the clip's one <video>, found ${found.length}`)
  return found[0]
}

function dockButton(text: (t: string) => boolean, what: string): HTMLButtonElement {
  const panel = document.querySelector('[data-reframe-panel]')
  if (!panel) throw new Error('reframe check: the dock has no Follow the subject section')
  const found = [...panel.querySelectorAll('button')].filter((b) => text((b.textContent ?? '').replace(/\s+/g, ' ').trim()))
  if (found.length !== 1) throw new Error(`reframe check: expected one ${what} button in the dock, found ${found.length}`)
  return found[0]
}

function aspectButton(key: '16:9' | '9:16'): HTMLButtonElement {
  const group = document.querySelector('[role="group"][aria-label="Aspect ratio"]')
  const found = [...(group?.querySelectorAll('button') ?? [])].filter((b) =>
    [...b.querySelectorAll('span')].some((s) => s.textContent === key)
  )
  if (found.length !== 1) throw new Error(`reframe check: expected one ${key} button on the canvas bar, found ${found.length}`)
  return found[0]
}

/* ---------------------------------------------------------------- pixels */

const SAMPLE = { width: 90, height: 160 }

/** The Output frame, CSS px, as the preview lays it out. */
function frameRect(): { x: number; y: number; width: number; height: number } {
  const box = previewBox()
  const rect = outputFrame(box, ASPECTS[editor().aspect], editor().splitRatio)
  if (!rect) throw new Error('reframe check: the preview shows no Output frame')
  return rect
}

/** A region of a canvas laid out like the preview's (CSS px × dpr), down to a fixed size. */
function sampleOf(canvas: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }, size = SAMPLE): ImageData {
  const { dpr } = previewBox()
  const inset = 3
  const out = document.createElement('canvas')
  out.width = size.width
  out.height = size.height
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(
    canvas,
    (rect.x + inset) * dpr,
    (rect.y + inset) * dpr,
    (rect.width - 2 * inset) * dpr,
    (rect.height - 2 * inset) * dpr,
    0,
    0,
    size.width,
    size.height
  )
  return ctx.getImageData(0, 0, size.width, size.height)
}

function meanDiff(a: ImageData, b: ImageData): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    n += 3
  }
  return n > 0 ? sum / n : 0
}

/**
 * The Output frame as it should be: the element's current frame through
 * `at` — the one crop, or the two halves stacked into a crop-sized canvas
 * first, as the export's `vstack` makes it — drawn where the preview draws a
 * full-frame clip (its box, contain-fitted), into a canvas the preview's size.
 */
function expectedOutput(video: HTMLVideoElement, clip: Clip, at: CropOnFrame): HTMLCanvasElement {
  const box = previewBox()
  const rect = frameRect()
  const canvas = document.createElement('canvas')
  canvas.width = previewCanvas().width
  canvas.height = previewCanvas().height
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

  let picture: CanvasImageSource = video
  let crop: CropRect = at.crop
  if (at.halves) {
    const { top, bottom } = at.halves
    const stack = document.createElement('canvas')
    stack.width = top.width
    stack.height = top.height + bottom.height
    const s = stack.getContext('2d')!
    s.drawImage(video, top.x, top.y, top.width, top.height, 0, 0, top.width, top.height)
    s.drawImage(video, bottom.x, bottom.y, bottom.width, bottom.height, 0, top.height, bottom.width, bottom.height)
    picture = stack
    crop = { x: 0, y: 0, width: stack.width, height: stack.height }
  }
  const target = ASPECTS[editor().aspect]
  const place = clipBox(clip, target)
  const px = rect.width / target.width
  const py = rect.height / target.height
  const w = place.width * px
  const h = place.height * py
  const scale = place.fit === 'cover' ? Math.max(w / crop.width, h / crop.height) : Math.min(w / crop.width, h / crop.height)
  ctx.drawImage(
    picture,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    rect.x + place.x * px + (w - crop.width * scale) / 2,
    rect.y + place.y * py + (h - crop.height * scale) / 2,
    crop.width * scale,
    crop.height * scale
  )
  return canvas
}

/** The Output frame now, against the element's frame through `right`, and through `wrong`. */
function compareOutput(video: HTMLVideoElement, clip: Clip, frame: number, right: CropOnFrame, wrong: CropOnFrame, size = SAMPLE): Compare {
  const rect = frameRect()
  const shown = sampleOf(previewCanvas(), rect, size)
  return {
    frame,
    diff: meanDiff(shown, sampleOf(expectedOutput(video, clip, right), rect, size)),
    wrong: meanDiff(shown, sampleOf(expectedOutput(video, clip, wrong), rect, size)),
    stacked: Boolean(right.halves)
  }
}

const sameCrop = (a: CropRect, b: CropRect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
const sameAt = (a: CropOnFrame, b: CropOnFrame): boolean =>
  sameCrop(a.crop, b.crop) &&
  Boolean(a.halves) === Boolean(b.halves) &&
  (!a.halves || (sameCrop(a.halves.top, b.halves!.top) && sameCrop(a.halves.bottom, b.halves!.bottom)))

/* ---------------------------------------------------------------- the clip */

const clipNow = (id: string): Clip => {
  const found = editor().project.clips.find((c) => c.id === id)
  if (!found) throw new Error(`reframe check: clip ${id} is gone`)
  return found
}

const keysNow = (id: string): FollowKeys | null => {
  const project = editor().project
  return followKeys(project, clipNow(id), project.settings.fps)
}

/** The crop the clip shows on its own frame `frame`, read through the one reader. */
function at(id: string, asset: MediaAsset, frame: number): CropOnFrame {
  const project = editor().project
  return cropAt(project, clipNow(id), { width: asset.width ?? 0, height: asset.height ?? 0 }, frame)
}

/** The playhead on the clip's own frame `frame`, the element seeked there and the preview repainted. */
async function showFrame(clipId: string, video: HTMLVideoElement, frame: number): Promise<void> {
  const clip = clipNow(clipId)
  editor().setPlayhead(clip.start + frame)
  const fps = editor().project.settings.fps
  const target = framesToSeconds(sourceFrameFor(clip, clip.start + frame), fps)
  await until(
    () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.021,
    5000,
    `the element seeking to ${target.toFixed(3)} s`
  )
  await settled()
}

/**
 * The preview has stopped changing: two looks at the Output a few frames
 * apart are the same picture. A paused preview repaints only when something
 * changed (its `dirty` flag, a seek's `seeked`), and a compare taken between
 * an edit and its repaint measured the old picture against the new crop —
 * once, 3.41/255, on the frame after Stack two people was pressed.
 */
async function settled(): Promise<void> {
  const rect = (): { x: number; y: number; width: number; height: number } => {
    const box = previewBox()
    return { x: 0, y: 0, width: box.width, height: box.height }
  }
  let last = sampleOf(previewCanvas(), rect())
  const stop = performance.now() + 2000
  for (;;) {
    await frames(3)
    const now = sampleOf(previewCanvas(), rect())
    if (meanDiff(last, now) === 0) return
    if (performance.now() > stop) throw new Error('reframe check: the preview did not settle on one picture in 2 s')
    last = now
  }
}

const centre = (rect: CropRect): number => rect.x + rect.width / 2

/* ---------------------------------------------------------------- the check */

export async function runReframeCheck(): Promise<ReframeCheckReport> {
  const started = performance.now()
  const failures: string[] = []
  const expect = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what)
  }
  const report: ReframeCheckReport = {
    setup: null,
    follow: null,
    shots: [],
    paused: [],
    cuts: [],
    outline: null,
    playing: null,
    roundTrip: null,
    drag: null,
    dragHalf: null,
    stackOff: null,
    undo: null,
    failures,
    ms: 0
  }
  if (document.visibilityState !== 'visible') {
    throw new Error('reframe check: the harness tab is hidden — bring it to the front (the video is recorded with requestAnimationFrame)')
  }

  try {
    /* 1. The talk on a 9:16 canvas, selected; the press; the track in one undo step. */
    const url = await recordColumnsVideo()
    editor().setPlaying(false)
    editor().newProject()
    await editor().importAssets([url])
    const asset = editor().project.assets.find((a) => a.path === url)
    if (!asset || asset.kind !== 'video') throw new Error('reframe check: the recorded video did not import as a video')
    editor().addAssetToTimeline(asset.id)
    const placed = editor().project.clips.filter((c) => c.assetId === asset.id)
    if (placed.length !== 1) throw new Error(`reframe check: placing the video made ${placed.length} clips`)
    const clipId = placed[0].id
    editor().setAspect('9:16')
    editor().setSplitRatio(0)
    editor().setPreviewTool('select')
    editor().select(clipId)
    editor().setPlayhead(placed[0].start)
    editor().setReframeHelper('ready')
    editor().setReframeModel(null)
    harnessReframe.modelPresent = false
    const fps = editor().project.settings.fps
    const source = { width: asset.width ?? 0, height: asset.height ?? 0 }
    report.setup = { assetId: asset.id, clipId, fps, source, video: url }
    expect(source.width === 640 && source.height === 360, `the video is ${source.width}×${source.height}, not 640×360`)
    await frames(3)
    const video = await until(() => {
      try {
        return videoFor(asset)
      } catch {
        return null
      }
    }, 5000, "the preview's <video> for the clip")

    const firstTime = await until(
      () => {
        try {
          const b = dockButton((t) => t.startsWith('Follow the subject'), 'Follow the subject')
          return (b.textContent ?? '').includes('gets the face finder') ? b : null
        } catch {
          return null
        }
      },
      5000,
      'the dock naming the face finder before the first press'
    )
    const labelBefore = (firstTime.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(
      labelBefore === 'Follow the subject · gets the face finder, 1.1 MB, first time',
      `the dock reads "${labelBefore}" before the first press`
    )
    const pastBefore = editor().past.length
    const jobsBefore = harnessReframe.jobs.length
    const pressed = performance.now()
    firstTime.click()
    await until(() => clipNow(clipId).follow && editor().project.subjects?.[asset.id], 15_000, 'the clip following its subject')
    await frames(3)
    report.follow = {
      labelBefore,
      fetched: harnessReframe.modelPresent,
      jobs: harnessReframe.jobs.length - jobsBefore,
      undoSteps: editor().past.length - pastBefore,
      ms: Math.round(performance.now() - pressed)
    }
    expect(report.follow.fetched, 'the press did not fetch the face finder')
    expect(report.follow.jobs === 1, `the press started ${report.follow.jobs} analyses, not 1`)
    expect(report.follow.undoSteps === 1, `the follow took ${report.follow.undoSteps} undo steps, not 1`)

    /* 2. The crops, from the compiled keys — and where the stub's faces are. */
    const keys = keysNow(clipId)
    if (!keys) throw new Error('reframe check: the followed clip has no keys')
    expect(keys.shots.length === HARNESS_SHOT_STARTS.length, `${keys.shots.length} shots, not ${HARNESS_SHOT_STARTS.length}`)
    for (const shot of keys.shots) {
      const mid = Math.floor((shot.from + shot.to) / 2)
      const here = at(clipId, asset, mid)
      const faces = (HARNESS_FACE_CENTRES[shot.index] ?? []).map((x) => x * source.width)
      const centres = here.halves ? [centre(here.halves.top), centre(here.halves.bottom)] : [centre(here.crop)]
      report.shots.push({
        index: shot.index,
        startMs: shot.startMs,
        from: shot.from,
        to: shot.to,
        why: shot.why,
        crop: here.crop,
        halves: here.halves ?? null,
        centres,
        faces
      })
      if (faces.length === 1) {
        expect(!here.halves && Math.abs(centres[0] - faces[0]) <= 2, `shot ${shot.index + 1}'s crop is centred at ${centres[0]}, its face at ${faces[0]}`)
      } else {
        expect(Boolean(here.halves), `shot ${shot.index + 1} has two faces too far apart and is not stacked`)
        // The face further LEFT on top (§4.6 rule 3), each half centred on its own.
        expect(
          centres.length === 2 && Math.abs(centres[0] - faces[0]) <= 2 && Math.abs(centres[1] - faces[1]) <= 2,
          `shot ${shot.index + 1}'s halves are centred at ${centres.join(', ')}, its faces at ${faces.join(', ')}`
        )
      }
    }

    /* 3. Paused: inside each shot, and either side of every cut. */
    for (const [k, shot] of keys.shots.entries()) {
      const mid = Math.floor((shot.from + shot.to) / 2)
      await showFrame(clipId, video, mid)
      const right = at(clipId, asset, mid)
      // Inside the two-up the wrong picture is the one crop it replaced; elsewhere, the next shot's crop.
      const next = keys.shots[k + 1] ?? keys.shots[k - 1]
      const wrong = right.halves ? { crop: right.crop } : at(clipId, asset, Math.floor((next.from + next.to) / 2))
      const c = compareOutput(video, clipNow(clipId), mid, right, wrong)
      report.paused.push(c)
      expect(c.diff <= 2, `shot ${shot.index + 1}, frame ${mid}: the Output differs from the expected ${c.stacked ? 'stack' : 'crop'} by ${c.diff.toFixed(2)}/255`)
      expect(c.wrong > 8, `shot ${shot.index + 1}, frame ${mid}: the wrong picture is only ${c.wrong.toFixed(2)}/255 away — the compare cannot tell`)
    }
    for (const shot of keys.shots.slice(1)) {
      const cut = shot.from
      const sides: Compare[] = []
      for (const frame of [cut - 1, cut]) {
        await showFrame(clipId, video, frame)
        const right = at(clipId, asset, frame)
        const other = at(clipId, asset, frame === cut ? cut - 1 : cut)
        const c = compareOutput(video, clipNow(clipId), frame, right, other)
        sides.push(c)
        expect(c.diff <= 2, `cut at ${cut}, frame ${frame}: the Output differs from its crop by ${c.diff.toFixed(2)}/255`)
        expect(c.wrong > 8, `cut at ${cut}, frame ${frame}: the other side's crop is only ${c.wrong.toFixed(2)}/255 away`)
      }
      report.cuts.push({ cut, before: sides[0], at: sides[1] })
    }

    /* 4. The Source outline in the third shot: two rectangles. */
    {
      const third = keys.shots[2]
      const mid = Math.floor((third.from + third.to) / 2)
      editor().setSplitRatio(1)
      await showFrame(clipId, video, mid)
      const here = at(clipId, asset, mid)
      if (!here.halves) throw new Error('reframe check: the third shot is not stacked, so its outline cannot be two rectangles')
      const box = previewBox()
      const fit = Math.min(box.width / source.width, box.height / source.height)
      const ox = (box.width - source.width * fit) / 2
      const oy = (box.height - source.height * fit) / 2
      // Lit over dimmed: the outline's dark fill over the picture, against the element drawn bare.
      const ratio = (sx: number, sy: number): number => {
        const half = 4
        const x = (ox + sx * fit) * box.dpr
        const y = (oy + sy * fit) * box.dpr
        const shown = previewCanvas().getContext('2d')!.getImageData(Math.round(x - half), Math.round(y - half), half * 2, half * 2)
        const bare = document.createElement('canvas')
        bare.width = half * 2
        bare.height = half * 2
        const b = bare.getContext('2d')!
        b.drawImage(video, sx - half / (fit * box.dpr), sy - half / (fit * box.dpr), (half * 2) / (fit * box.dpr), (half * 2) / (fit * box.dpr), 0, 0, half * 2, half * 2)
        const want = b.getImageData(0, 0, half * 2, half * 2)
        const luma = (d: ImageData): number => {
          let s = 0
          for (let i = 0; i < d.data.length; i += 4) s += 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]
          return s / (d.data.length / 4)
        }
        return luma(shown) / Math.max(1, luma(want))
      }
      const { top, bottom } = here.halves
      const one = here.crop
      // Rows outside both halves but inside the one crop (it runs the full height).
      const spareY = top.y + top.height + 20 < source.height ? top.y + top.height + 20 : Math.max(5, top.y - 20)
      const probes: { name: string; x: number; y: number; want: 'lit' | 'dim' }[] = [
        { name: 'the top half', x: centre(top), y: top.y + top.height / 2, want: 'lit' },
        { name: 'the bottom half', x: centre(bottom), y: bottom.y + bottom.height / 2, want: 'lit' },
        { name: 'the bottom half, outside the one crop', x: Math.min(bottom.x + bottom.width - 6, one.x + one.width + 30), y: bottom.y + bottom.height / 2, want: 'lit' },
        { name: 'the one crop, outside both halves', x: centre(one), y: spareY, want: 'dim' },
        { name: 'outside everything', x: 12, y: source.height / 2, want: 'dim' }
      ]
      report.outline = { probes: probes.map((p) => ({ name: p.name, ratio: Math.round(ratio(p.x, p.y) * 100) / 100, want: p.want })) }
      for (const p of report.outline.probes) {
        expect(p.want === 'lit' ? p.ratio > 0.85 : p.ratio < 0.6, `the Source outline at ${p.name}: ${p.ratio} of the bare picture, wanted ${p.want}`)
      }
      editor().setSplitRatio(0)
      await frames(3)
    }

    /*
     * 5. Playing (§15 row 5), twice: as it plays, and with the element nudged
     * off the playhead — 3 frames ahead through the first cut, then 3 behind
     * through the second, both inside the 0.18 s the preview lets a playing
     * element drift before it re-seeks (Preview.tsx DRIFT_TOLERANCE). In the
     * harness the element and the playhead keep step exactly, so without the
     * nudge the two rules — the crop at the element's frame, the crop at the
     * playhead's — never disagree and nothing would say which the preview
     * follows. With it, around each cut they disagree for three frames.
     */
    {
      const natural = await playThrough(clipId, asset, video, keys, false)
      const nudged = await playThrough(clipId, asset, video, keys, true)
      report.playing = { natural, nudged }
      for (const [name, pass] of [['as it plays', natural], ['nudged', nudged]] as const) {
        expect(pass.frames >= 60, `${name}: only ${pass.frames} frames were presented while playing six seconds`)
        const wrong = pass.nearCuts.filter((n) => n.drew !== 'same' && n.drew !== 'element')
        expect(
          wrong.length === 0,
          `${name}: around the cuts the preview drew ${wrong.map((n) => `${n.drew} at element ${n.elementFrame} / playhead ${n.playheadFrame}`).join('; ')}`
        )
        const misses = pass.nearCuts.filter((n) => n.drew === 'same' && n.diffElement > 4)
        expect(misses.length === 0, `${name}: ${misses.length} near-cut frames matched their crop by more than 4/255`)
      }
      // The nudge has to have made the rules disagree, or the pass proved nothing.
      expect(nudged.differing >= 2, `nudged: the element's and the playhead's crops disagreed on only ${nudged.differing} near-cut frames`)
    }

    /* 6. 9:16 → 16:9 → 9:16 on the canvas bar's own buttons. */
    {
      const before = keys.shots.map((s) => at(clipId, asset, Math.floor((s.from + s.to) / 2)))
      const storedBefore = clipNow(clipId).crop
      aspectButton('16:9').click()
      await frames(3)
      const wide = keysNow(clipId)
      const at169 = {
        follows: Boolean(clipNow(clipId).follow),
        note: wide?.notes.find((n) => n.includes('nothing to follow')) ?? null
      }
      expect(editor().aspect === '16:9', 'the 16:9 button did not change the canvas')
      expect(at169.follows, 'the clip stopped following on 16:9')
      aspectButton('9:16').click()
      await frames(3)
      const after = keysNow(clipId)
      const crops = after ? after.shots.map((s) => at(clipId, asset, Math.floor((s.from + s.to) / 2))) : []
      const back = Boolean(clipNow(clipId).follow) && crops.length === before.length && crops.every((c, i) => sameAt(c, before[i]))
      report.roundTrip = { at169, back, crops: crops.map((c) => c.crop) }
      expect(back, 'after 9:16 → 16:9 → 9:16 the crops did not come back')
      const storedAfter = clipNow(clipId).crop
      expect(
        !!storedBefore && !!storedAfter && sameCrop(storedBefore, storedAfter),
        `the stored crop went from ${JSON.stringify(storedBefore)} to ${JSON.stringify(storedAfter)}`
      )
    }

    /* 7–8. The drags: the second shot, then the two-up's bottom half. */
    await dragShot(clipId, asset, video, report, expect)
    await dragBottomHalf(clipId, asset, video, report, expect)

    /* 9. Stack two people off — after the dragged two-up is checked on the Output. */
    {
      const third = keysNow(clipId)!.shots[2]
      const mid = Math.floor((third.from + third.to) / 2)
      await showFrame(clipId, video, mid)
      // The two-up with its bottom half dragged (step 8), as drawn: the wrong picture is the stack before the drag.
      const dragged = at(clipId, asset, mid)
      const undragged: CropOnFrame | null =
        dragged.halves && report.dragHalf
          ? { ...dragged, halves: { ...dragged.halves, bottom: { ...dragged.halves.bottom, x: dragged.halves.bottom.x - report.dragHalf.bottomMoved } } }
          : null
      const before = compareOutput(video, clipNow(clipId), mid, dragged, undragged ?? { crop: dragged.crop })
      expect(before.diff <= 2, `the dragged two-up: the Output differs from its halves by ${before.diff.toFixed(2)}/255`)
      dockButton((t) => t === 'Stack two people', 'Stack two people').click()
      await frames(3)
      await showFrame(clipId, video, mid)
      const here = at(clipId, asset, mid)
      const faces = HARNESS_FACE_CENTRES[2].map((x) => x * source.width)
      // The wrong picture now is the stack it replaced.
      const c = compareOutput(video, clipNow(clipId), mid, here, dragged)
      report.stackOff = { before, twoUp: clipNow(clipId).follow?.twoUp, halves: Boolean(here.halves), centre: centre(here.crop), compare: c }
      expect(report.stackOff.twoUp === false, 'Stack two people did not write twoUp: false')
      expect(!here.halves, 'with Stack two people off the third shot is still stacked')
      // Equal faces: the larger by area ties, and the left one is kept (path.ts subjectMarks).
      expect(Math.abs(report.stackOff.centre - faces[0]) <= 2, `with Stack two people off the crop is centred at ${report.stackOff.centre}, not on the left face ${faces[0]}`)
      expect(c.diff <= 2, `with Stack two people off the Output differs from the one crop by ${c.diff.toFixed(2)}/255`)
      expect(c.wrong > 8, `with Stack two people off the stack it replaced is only ${c.wrong.toFixed(2)}/255 away`)
    }

    /* 10. Undo, step by step, back to before the follow. */
    {
      const steps: string[] = []
      const undoTo = (what: string, ok: () => boolean): void => {
        editor().undo()
        steps.push(what)
        expect(ok(), `undo did not restore ${what}`)
      }
      undoTo('Stack two people on', () => clipNow(clipId).follow?.twoUp !== false)
      undoTo('the bottom half where it was', () => !clipNow(clipId).follow?.halfOffsets?.[HARNESS_SHOT_STARTS[2]])
      undoTo('the second shot where it was', () => clipNow(clipId).follow?.offsets?.[HARNESS_SHOT_STARTS[1]] === undefined)
      undoTo('16:9', () => editor().aspect === '16:9' && Boolean(clipNow(clipId).follow))
      undoTo('9:16, following', () => editor().aspect === '9:16' && Boolean(clipNow(clipId).follow))
      undoTo('the clip before the follow', () => !clipNow(clipId).follow && !editor().project.subjects?.[asset.id])
      await frames(3)
      report.undo = { steps, unfollowed: !clipNow(clipId).follow }
    }
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err))
  } finally {
    editor().setPlaying(false)
    // The stub's analyses off EXPORT's list once done, as Clear would: the page's next check starts from none.
    await window.forge.clearFinished().catch(() => undefined)
  }
  report.ms = Math.round(performance.now() - started)
  return report
}

/* ---------------------------------------------------------------- playing */

/**
 * Play the clip through from its first frame and, on every frame the element
 * PRESENTS (`requestVideoFrameCallback`), once the preview has painted it
 * (the next animation frame, then a task): the element's frame — the export's
 * frame for its presented media time, `exportFrameAt` — the playhead's, and,
 * within three frames of a cut, which crop the Output shows.
 */
async function playThrough(clipId: string, asset: MediaAsset, video: HTMLVideoElement, keys: FollowKeys, nudge: boolean): Promise<PlayPass> {
  const fps = editor().project.settings.fps
  const clip = clipNow(clipId)
  await showFrame(clipId, video, 0)
  const cuts = keys.shots.slice(1).map((s) => s.from)
  const played: PlayedFrame[] = []
  const nearCuts: NearCut[] = []
  const small = { width: 54, height: 96 }
  /*
   * Where each nudge lands and the drift it leaves (playhead − element, in
   * frames): the element 3 frames AHEAD through the first cut, 3 BEHIND
   * through the second. Set from the drift measured when it lands, not by a
   * fixed step: a play can start with the element some frames off already
   * (measured: 4 ahead for the first second of a pass), and a fixed +0.1 s on
   * top of that went past the 0.18 s the preview tolerates and was re-seeked.
   */
  const nudges = nudge
    ? [
        { at: Math.max(1, cuts[0] - 30), drift: -3 },
        { at: Math.floor((cuts[0] + cuts[1]) / 2) + 5, drift: 3 }
      ]
    : []
  const nudgedAt: number[] = []
  let done = false
  const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
    if (done) return
    const mediaTime = metadata.mediaTime
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (done) return
        const c = clipNow(clipId)
        const raw = exportFrameAt(c, fps, mediaTime * 1000)
        const elementFrame = Math.max(0, Math.min(c.duration - 1, raw ?? 0))
        const playheadFrame = editor().playhead - c.start
        const row: PlayedFrame = { mediaTime, elementFrame, playheadFrame }
        played.push(row)
        const next = nudges[0]
        if (next && elementFrame >= next.at) {
          nudges.shift()
          nudgedAt.push(elementFrame)
          // element_new = playhead − drift: move it by (playhead − drift − element) frames.
          video.currentTime = video.currentTime + (playheadFrame - next.drift - elementFrame) / fps
        }
        const cut = cuts.find((f) => Math.abs(elementFrame - f) <= 3 || Math.abs(playheadFrame - f) <= 3)
        if (cut === undefined) return
        const byElement = at(clipId, asset, elementFrame)
        const byPlayhead = at(clipId, asset, Math.max(0, Math.min(c.duration - 1, playheadFrame)))
        const rect = frameRect()
        const shown = sampleOf(previewCanvas(), rect, small)
        const diffElement = meanDiff(shown, sampleOf(expectedOutput(video, c, byElement), rect, small))
        const same = sameAt(byElement, byPlayhead)
        const diffPlayhead = same ? diffElement : meanDiff(shown, sampleOf(expectedOutput(video, c, byPlayhead), rect, small))
        const drew: NearCut['drew'] = same
          ? 'same'
          : diffElement <= 4 && diffElement < diffPlayhead
            ? 'element'
            : diffPlayhead <= 4 && diffPlayhead < diffElement
              ? 'playhead'
              : 'neither'
        nearCuts.push({ ...row, cut, diffElement: round2(diffElement), diffPlayhead: round2(diffPlayhead), drew })
      }, 0)
    )
    video.requestVideoFrameCallback(onFrame)
  }
  video.requestVideoFrameCallback(onFrame)
  editor().setPlaying(true)
  const end = clipEnd(clip)
  try {
    await until(() => editor().playhead >= end - 2 || !editor().playing, 12_000, 'playing the clip through')
  } finally {
    done = true
    editor().setPlaying(false)
  }
  await frames(3)
  /*
   * Measured: with Scrub on (the default) and a clip with no sound, stopping
   * playback does NOT pause the element — Preview.tsx syncMedia skips the
   * pause while scrubbing and leaves the stop to a scrub burst, which only an
   * audible element gets — so it plays on to its end behind a stopped
   * playhead. Not the reframe's; recorded here, and the element paused so
   * the steps after this one start from a still picture.
   */
  const stillPlaying = !video.paused
  if (stillPlaying) video.pause()
  const drifts = played.map((p) => p.playheadFrame - p.elementFrame)
  const differing = nearCuts.filter((n) => n.drew !== 'same')
  return {
    frames: played.length,
    drift: {
      min: drifts.length ? Math.min(...drifts) : 0,
      max: drifts.length ? Math.max(...drifts) : 0,
      mean: drifts.length ? round2(drifts.reduce((a, b) => a + b, 0) / drifts.length) : 0
    },
    nearCuts,
    elementHeld: differing.filter((n) => n.drew === 'element').length,
    differing: differing.length,
    drifts,
    nudgedAt,
    stillPlaying
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/* ---------------------------------------------------------------- drags */

type Expect = (ok: boolean, what: string) => void

function pointer(target: Element, type: string, x: number, y: number, buttons: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y })
  )
}

/**
 * A drag from (x, y) by (dx, dy) client px, as the pointer would: down on what
 * is under it, moves and up on it.
 *
 * A dispatched pointer is not an ACTIVE pointer, and `setPointerCapture` on
 * one throws (measured: "No active pointer with the given id is found") —
 * inside the overlay's pointerdown, before the drag begins, so nothing moved
 * and nothing said why. The capture only routes later events to the element,
 * and these are dispatched on it anyway, so it is a no-op for the gesture.
 */
async function dragAt(x: number, y: number, dx: number, dy: number): Promise<Element> {
  const target = document.elementFromPoint(x, y)
  if (!target) throw new Error(`reframe check: nothing under the pointer at ${x}, ${y}`)
  const capture = Element.prototype.setPointerCapture
  const release = Element.prototype.releasePointerCapture
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  try {
    pointer(target, 'pointerdown', x, y, 1)
    await frames(1)
    for (let i = 1; i <= 4; i++) {
      pointer(target, 'pointermove', x + (dx * i) / 4, y + (dy * i) / 4, 1)
      await frames(1)
    }
    pointer(target, 'pointerup', x + dx, y + dy, 0)
    await frames(3)
  } finally {
    Element.prototype.setPointerCapture = capture
    Element.prototype.releasePointerCapture = release
  }
  return target
}

/**
 * 7. The second shot dragged right on the Source outline (Reframe on, Split
 * view): its offset kept under its startMs as a share of the crop, its crop
 * moved by the drag, the other shots where they were; one undo step.
 */
async function dragShot(clipId: string, asset: MediaAsset, video: HTMLVideoElement, report: ReframeCheckReport, expect: Expect): Promise<void> {
  const keys = keysNow(clipId)!
  const second = keys.shots[1]
  const mid = Math.floor((second.from + second.to) / 2)
  const before = keys.shots.map((s) => at(clipId, asset, Math.floor((s.from + s.to) / 2)))
  editor().setSplitRatio(0.5)
  editor().setPreviewTool('crop')
  await showFrame(clipId, video, mid)
  const overlay = await until(
    () => document.querySelector<HTMLElement>('[data-forge-follow="one"]'),
    3000,
    "the followed crop's rectangle on the Source outline"
  )
  const box = overlay.getBoundingClientRect()
  const pastBefore = editor().past.length
  // Left by 60 source px: the pointer moves the rectangle, and the crop goes with it (playback.ts dragShare).
  const scale = box.width / before[1].crop.width
  const dxSource = -60
  await dragAt(box.left + box.width / 2, box.top + box.height / 2, dxSource * scale, 0)
  const share = clipNow(clipId).follow?.offsets?.[second.startMs] ?? null
  const after = keysNow(clipId)!.shots.map((s) => at(clipId, asset, Math.floor((s.from + s.to) / 2)))
  const moved = after[1].crop.x - before[1].crop.x
  const others = after.every((c, i) => i === 1 || sameAt(c, before[i]))
  report.drag = { shot: 1, share, moved, others, undoSteps: editor().past.length - pastBefore }
  expect(share !== null && Math.abs(share * before[1].crop.width - dxSource) <= 3, `the drag kept ${share} under shot 2's startMs, wanted about ${dxSource / before[1].crop.width}`)
  expect(Math.abs(moved - dxSource) <= 3, `shot 2's crop moved ${moved} px for a ${dxSource} px drag`)
  expect(others, 'dragging shot 2 moved another shot')
  expect(report.drag.undoSteps === 1, `the drag took ${report.drag.undoSteps} undo steps, not 1`)
  editor().setPreviewTool('select')
  editor().setSplitRatio(0)
  await frames(3)
}

/**
 * 8. The two-up's BOTTOM half dragged on the Output side of the split
 * (Reframe on; the reframe rectangles need the source on screen, so Reframe
 * opens the split): a drag in the lower half of the picture moves only the
 * bottom half, its offset kept under the shot's startMs; one undo step.
 */
async function dragBottomHalf(clipId: string, asset: MediaAsset, video: HTMLVideoElement, report: ReframeCheckReport, expect: Expect): Promise<void> {
  const keys = keysNow(clipId)!
  const third = keys.shots[2]
  const mid = Math.floor((third.from + third.to) / 2)
  editor().setSplitRatio(0.5)
  editor().setPreviewTool('crop')
  await showFrame(clipId, video, mid)
  await until(() => document.querySelector('[data-forge-follow="output"]'), 3000, 'the followed drag on the Output side')
  const before = at(clipId, asset, mid)
  if (!before.halves) throw new Error('reframe check: the third shot is not stacked, so there is no bottom half to drag')
  const rect = frameRect()
  const canvasBox = previewCanvas().getBoundingClientRect()
  // A point in the Output frame's lower half.
  const x = canvasBox.left + rect.x + rect.width / 2
  const y = canvasBox.top + rect.y + rect.height * 0.75
  const pastBefore = editor().past.length
  // Screen px per SOURCE px on the Output: the stack fills the frame at the half's width.
  const outputPx = rect.width / before.halves.bottom.width
  const dxSource = 40
  await dragAt(x, y, dxSource * outputPx, 0)
  const follow = clipNow(clipId).follow
  const half = follow?.halfOffsets?.[third.startMs]
  const after = at(clipId, asset, mid)
  const bottomMoved = (after.halves?.bottom.x ?? NaN) - before.halves.bottom.x
  const topMoved = (after.halves?.top.x ?? NaN) - before.halves.top.x
  report.dragHalf = {
    share: half?.bottom ? { x: half.bottom.x, y: half.bottom.y } : null,
    bottomMoved,
    topMoved,
    undoSteps: editor().past.length - pastBefore
  }
  // On the Output the PICTURE follows the pointer, so the crop moves against it (playback.ts outputDragScale;
  // on the Source outline the rectangle — the crop — follows it). Decided 2026-10-14.
  expect(Math.abs(bottomMoved + dxSource) <= 3, `the bottom half moved ${bottomMoved} px for a ${dxSource} px drag right on the Output (want −${dxSource}: the picture with the pointer)`)
  expect(topMoved === 0, `dragging the bottom half moved the top one ${topMoved} px`)
  expect(!half?.top || (half.top.x === 0 && half.top.y === 0), `the top half got an offset too: ${JSON.stringify(half?.top)}`)
  expect(report.dragHalf.undoSteps === 1, `the half's drag took ${report.dragHalf.undoSteps} undo steps, not 1`)
  editor().setPreviewTool('select')
  editor().setSplitRatio(0)
  await frames(3)
}

export function installReframeCheck(): void {
  ;(window as unknown as { __forgeReframeCheck: typeof runReframeCheck }).__forgeReframeCheck = runReframeCheck
}
