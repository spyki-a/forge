import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { cropAt, safeCrop } from '@shared/render/crop'
import { followKeys } from '@shared/reframe/keys'
import {
  clipFrameAtPlayhead,
  dragHalfShare,
  dragShare,
  followShotAt,
  halfAtOutput,
  halfUnderPointer,
  outputDragScale
} from '@shared/reframe/playback'
import type { Clip, CropRect, MediaAsset } from '@shared/timeline'
import { useEditor } from '../store'
import type { ViewTransform } from './Preview'

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const HANDLES: { id: Handle; className: string; cursor: string }[] = [
  { id: 'nw', className: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
  { id: 'ne', className: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
  { id: 'sw', className: '-left-1.5 -bottom-1.5', cursor: 'nesw-resize' },
  { id: 'se', className: '-right-1.5 -bottom-1.5', cursor: 'nwse-resize' }
]

/**
 * Draggable reframe rectangle over the preview.
 *
 * The aspect ratio is locked — the crop feeds a fixed export canvas, so letting
 * it change shape would silently letterbox the result. Corner handles scale it;
 * the body moves it.
 *
 * A clip that FOLLOWS its subject gets `FollowedCrop` instead: its crop is
 * compiled from the file's track (docs/CLIPS.md §4.7), so a drag corrects the
 * shot under the playhead rather than setting one rectangle for the clip.
 */
export function CropOverlay(props: { clip: Clip; asset: MediaAsset; transform: ViewTransform }): ReactNode {
  return props.clip.follow ? <FollowedCrop {...props} /> : <StaticCrop {...props} />
}

function StaticCrop({
  clip,
  asset,
  transform
}: {
  clip: Clip
  asset: MediaAsset
  transform: ViewTransform
}): ReactNode {
  const setCrop = useEditor((s) => s.setCrop)
  const begin = useEditor((s) => s.begin)
  const commit = useEditor((s) => s.commit)
  const drag = useRef<{ handle: Handle; startX: number; startY: number; origin: CropRect } | null>(null)

  const crop = clip.crop
  const sourceW = asset.width ?? 0
  const sourceH = asset.height ?? 0

  const onPointerDown = useCallback(
    (handle: Handle) => (event: ReactPointerEvent) => {
      if (!crop) return
      event.preventDefault()
      event.stopPropagation()
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      drag.current = { handle, startX: event.clientX, startY: event.clientY, origin: { ...crop } }
      begin()
    },
    [crop, begin]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const state = drag.current
      if (!state || !crop) return

      const dx = (event.clientX - state.startX) / transform.scale
      const dy = (event.clientY - state.startY) / transform.scale
      const origin = state.origin

      if (state.handle === 'move') {
        setCrop(clip.id, {
          ...origin,
          x: Math.round(Math.max(0, Math.min(sourceW - origin.width, origin.x + dx))),
          y: Math.round(Math.max(0, Math.min(sourceH - origin.height, origin.y + dy)))
        })
        return
      }

      // Corner resize, aspect locked: drive from the horizontal delta and derive
      // height, so the rectangle can never change shape.
      const ratio = origin.width / origin.height
      const signX = state.handle === 'ne' || state.handle === 'se' ? 1 : -1
      let width = origin.width + dx * signX
      width = Math.max(80, Math.min(width, sourceW, sourceH * ratio))
      const height = width / ratio

      const anchorRight = state.handle === 'nw' || state.handle === 'sw'
      const anchorBottom = state.handle === 'nw' || state.handle === 'ne'

      let x = anchorRight ? origin.x + origin.width - width : origin.x
      let y = anchorBottom ? origin.y + origin.height - height : origin.y

      x = Math.max(0, Math.min(x, sourceW - width))
      y = Math.max(0, Math.min(y, sourceH - height))

      /*
       * Stored as the renderer will use it.
       *
       * The clamping above happens in floating point and is rounded afterwards,
       * so a rectangle dragged to the very edge could round back out past it —
       * and the handles then showed numbers the export silently disagreed with.
       * Running the result through the same function the render plan uses means
       * what the overlay draws is what gets cut.
       */
      const source = { width: sourceW, height: sourceH }
      // null means "this covers the whole frame", which the renderer answers by
      // emitting no crop at all. Mid-drag the rectangle still has to be drawn,
      // so it becomes the full frame rather than disappearing under the pointer.
      const safe = safeCrop({ x, y, width, height }, source) ?? {
        x: 0,
        y: 0,
        width: sourceW,
        height: sourceH
      }
      setCrop(clip.id, safe)
    },
    [clip.id, crop, setCrop, sourceW, sourceH, transform.scale]
  )

  const onPointerUp = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    // One undo entry per gesture, not per pointer event.
    commit()
  }, [commit])

  if (!crop) return null

  const left = transform.offsetX + crop.x * transform.scale
  const top = transform.offsetY + crop.y * transform.scale
  const width = crop.width * transform.scale
  const height = crop.height * transform.scale

  return (
    <div
      className="absolute cursor-move border-2 border-accent-500"
      style={{ left, top, width, height }}
      onPointerDown={onPointerDown('move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Rule-of-thirds guides make a reframe judgement much easier. */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-1/3 top-0 h-full w-px bg-white/50" />
        <div className="absolute left-2/3 top-0 h-full w-px bg-white/50" />
        <div className="absolute left-0 top-1/3 h-px w-full bg-white/50" />
        <div className="absolute left-0 top-2/3 h-px w-full bg-white/50" />
      </div>

      {HANDLES.map((handle) => (
        <div
          key={handle.id}
          className={`absolute size-3 rounded-sm border border-ink-950 bg-accent-500 ${handle.className}`}
          style={{ cursor: handle.cursor }}
          onPointerDown={onPointerDown(handle.id)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}

      <div className="pointer-events-none absolute -top-6 left-0 rounded bg-ink-950/90 px-1.5 py-0.5 text-[10px] text-ink-200">
        {crop.width}×{crop.height}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ following */

/** One drag of a followed crop: the shot it corrects, the half (on a two-up shot), and that offset as the drag found it. */
interface FollowDrag {
  startX: number
  startY: number
  shotIndex: number
  half: 'top' | 'bottom' | null
  origin: number | { x: number; y: number }
  /** SOURCE px per screen px. */
  perPixel: number
}

/**
 * Begin a drag on a followed clip: the shot under the playhead, and — on a
 * stacked two-up frame — the half `pick` names. The drag's offset is SET
 * from where the shot's offset was (`dragShare`), so a pointer that comes
 * back to where it started leaves the shot where it was.
 */
function startFollowDrag(
  clip: Clip,
  frame: number,
  fps: number,
  project: Parameters<typeof followKeys>[0],
  event: ReactPointerEvent,
  half: 'top' | 'bottom' | null,
  perPixel: number
): FollowDrag | null {
  const keys = followKeys(project, clip, fps)
  const shot = keys ? followShotAt(keys, frame) : null
  if (!keys || !shot || !clip.follow) return null
  const twoUp = shot.why === 'two-up'
  const which = twoUp ? half ?? 'top' : null
  const origin = which
    ? clip.follow.halfOffsets?.[shot.startMs]?.[which] ?? { x: 0, y: 0 }
    : clip.follow.offsets?.[shot.startMs] ?? 0
  return { startX: event.clientX, startY: event.clientY, shotIndex: shot.index, half: which, origin, perPixel }
}

function useFollowDrag(clip: Clip): {
  onPointerDown: (event: ReactPointerEvent, half: 'top' | 'bottom' | null, perPixel: number) => void
  onPointerMove: (event: ReactPointerEvent) => void
  onPointerUp: () => void
} {
  const begin = useEditor((s) => s.begin)
  const commit = useEditor((s) => s.commit)
  const dragFollowOffset = useEditor((s) => s.dragFollowOffset)
  const drag = useRef<FollowDrag | null>(null)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent, half: 'top' | 'bottom' | null, perPixel: number) => {
      const { project, playhead } = useEditor.getState()
      const started = startFollowDrag(clip, clipFrameAtPlayhead(clip, playhead), project.settings.fps, project, event, half, perPixel)
      if (!started) return
      event.preventDefault()
      event.stopPropagation()
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      drag.current = started
      // One undo entry per gesture, as the static crop's drag is.
      begin()
    },
    [clip, begin]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const state = drag.current
      if (!state) return
      const { project } = useEditor.getState()
      const now = project.clips.find((c) => c.id === clip.id)
      const keys = now ? followKeys(project, now, project.settings.fps) : null
      if (!keys) return
      const dx = (event.clientX - state.startX) * state.perPixel
      const dy = (event.clientY - state.startY) * state.perPixel
      if (state.half && typeof state.origin === 'object') {
        dragFollowOffset(clip.id, state.shotIndex, { half: state.half, ...dragHalfShare(keys, state.origin, dx, dy) })
      } else if (typeof state.origin === 'number') {
        dragFollowOffset(clip.id, state.shotIndex, dragShare(keys, state.origin, dx, dy))
      }
    },
    [clip.id, dragFollowOffset]
  )

  const onPointerUp = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    commit()
  }, [commit])

  return { onPointerDown, onPointerMove, onPointerUp }
}

/**
 * The Source outline of a followed clip: the crop where it is on the
 * playhead's frame — on a stacked two-up frame, both halves' rectangles. A
 * drag moves the shot under the playhead (`follow.offsets`, a share of the
 * crop); on a two-up frame, only the half under the pointer
 * (`follow.halfOffsets`, shares of the half), the other staying where it is.
 * No corner handles: a followed crop's size is the canvas's shape, one size
 * for the clip.
 */
function FollowedCrop({ clip, asset, transform }: { clip: Clip; asset: MediaAsset; transform: ViewTransform }): ReactNode {
  const project = useEditor((s) => s.project)
  const playhead = useEditor((s) => s.playhead)
  const { onPointerDown, onPointerMove, onPointerUp } = useFollowDrag(clip)
  const frame = clipFrameAtPlayhead(clip, playhead)
  const cut = cropAt(project, clip, { width: asset.width ?? 0, height: asset.height ?? 0 }, frame)
  const rects: { half: 'top' | 'bottom' | null; rect: CropRect }[] = cut.halves
    ? [
        { half: 'top', rect: cut.halves.top },
        { half: 'bottom', rect: cut.halves.bottom }
      ]
    : [{ half: null, rect: cut.crop }]

  const down = (fallback: 'top' | 'bottom' | null, rect: CropRect) => (event: ReactPointerEvent) => {
    // Where two halves overlap, the one whose centre is nearer the pointer (in SOURCE px) is the one under it.
    let half = fallback
    if (cut.halves) {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const x = rect.x + (event.clientX - box.left) / transform.scale
      const y = rect.y + (event.clientY - box.top) / transform.scale
      half = halfUnderPointer(cut.halves, x, y) ?? fallback
    }
    onPointerDown(event, half, 1 / transform.scale)
  }

  return (
    <>
      {rects.map(({ half, rect }) => (
        <div
          key={half ?? 'one'}
          data-forge-follow={half ?? 'one'}
          className="absolute cursor-move border-2 border-accent-500"
          style={{
            left: transform.offsetX + rect.x * transform.scale,
            top: transform.offsetY + rect.y * transform.scale,
            width: rect.width * transform.scale,
            height: rect.height * transform.scale
          }}
          onPointerDown={down(half, rect)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="pointer-events-none absolute -top-6 left-0 rounded bg-ink-950/90 px-1.5 py-0.5 text-[10px] text-ink-200">
            {half === 'top' ? 'Top · ' : half === 'bottom' ? 'Bottom · ' : ''}follows the subject
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * The same drag on the OUTPUT picture of a followed clip (docs/CLIPS.md §4.7):
 * the shot under the playhead moves; on a stacked two-up frame, the upper half
 * of the picture is the top half and the lower the bottom
 * (`halfAtOutput`). Screen pixels become SOURCE pixels by the followed crop's
 * width over the output's — the stack fills the frame at the canvas's shape —
 * with the sign turned: here the PICTURE follows the pointer, so the crop
 * moves against it (`outputDragScale`; on the Source outline the rectangle,
 * the crop itself, follows the pointer).
 */
export function FollowedOutputDrag({
  clip,
  asset,
  frame
}: {
  clip: Clip
  asset: MediaAsset
  frame: { x: number; y: number; width: number; height: number }
}): ReactNode {
  const project = useEditor((s) => s.project)
  const playhead = useEditor((s) => s.playhead)
  const { onPointerDown, onPointerMove, onPointerUp } = useFollowDrag(clip)
  if (!clip.follow) return null
  const cut = cropAt(project, clip, { width: asset.width ?? 0, height: asset.height ?? 0 }, clipFrameAtPlayhead(clip, playhead))
  const width = cut.halves ? cut.halves.top.width : cut.crop.width
  // Negative: the picture follows the pointer here, so the crop moves against it (playback.ts outputDragScale).
  const perPixel = outputDragScale(width, frame.width)
  return (
    <div
      data-forge-follow="output"
      className="absolute cursor-move"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      onPointerDown={(event) => {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const share = box.height > 0 ? (event.clientY - box.top) / box.height : 0
        onPointerDown(event, cut.halves ? halfAtOutput(share) : null, perPixel)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
