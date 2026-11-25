import { DEFAULT_COLOR, DEFAULT_TRANSFORM, emptyProject, type Clip, type MediaAsset, type Project } from '@shared/timeline'
import { soundPackFor, type SoundPack } from '@shared/director/soundRoles'
import { drawnStrings } from '@shared/graphics/apply'
import { drawListAt } from '@shared/graphics/drawList'
import { graphicMovingFrames } from '@shared/graphics/frame'
import type { DrawItem, TextItem, TextMeasure } from '@shared/graphics/items'
import { graphicStyleOf } from '@shared/graphics/style'
import type { GraphicData } from '@shared/graphics/template'
import { useCatalog } from '../catalog'
import { HARNESS_STEP_SIX, harnessStepSixRun, type HarnessStepSix } from './graphicsStub'

/**
 * `await window.__forgeGraphicCheck({ find: ['timeline', 'before-after', 'versus'] })`
 * (3D templates piece 2, docs/CLIPS.md §9): Find graphics' own path for each
 * of step 6's three, with the harness's stubbed answer (graphicsStub.ts
 * `harnessStepSixRun`), since the bridge has no model and the baseline makes
 * none of them. Each case builds its own project in memory (one 6 s,
 * 1080×1920, 30 fps footage clip; nothing on the page's timeline changes),
 * runs the real menu, validator, beats, placement, budget, sounds (the page's
 * library, as Find passes it) and landing, then draws the placed graphic at
 * its settled frame with the page's own text measure and reads back every
 * string its data holds. Plain data, for the session to read.
 */

export interface FindCase {
  template: string
  /** What the real menu offered over the talk. */
  offered: string[]
  /** Graphic clips of the template placed: 1 when all is well. */
  placed: number
  data: GraphicData | null
  /** Seconds from the graphic clip's start, one per element: 3 for the timeline's rows, 2 for the sides. */
  beats: number[]
  seconds: number | null
  /** Every string the data holds, and those not found among the settled frame's text items (empty when all is well). */
  strings: string[]
  missing: string[]
  /** Sounds placed for it: 1 (a tick) when the page's library holds clock_tick.wav, else 0. */
  sounds: number
  /** The run's notes (drops, repairs, landing notes such as "no sound library is installed"). */
  notes: string[]
  /** Those of them that drop a graphic ("graphic dropped: …"): empty when all is well. */
  dropped: string[]
  error: string | null
  pass: boolean
}

export interface FindResult {
  cases: FindCase[]
  /** Asked ids that are not one of step 6's three: never run. */
  unknown: string[]
}

const FPS = 30

/** A project of one 6 s, 1080×1920, 30 fps footage clip `V` (the bridge's own video length): what each case starts from. */
export function findProject(): { project: Project; clipId: string } {
  const base = emptyProject('find check')
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id
  const asset: MediaAsset = { id: 'find-video', path: '/find/video.mp4', name: 'video.mp4', kind: 'video', durationFrames: FPS * 6, width: 1080, height: 1920, fps: FPS, hasVideo: true, hasAudio: true, size: 1 }
  const clip: Clip = { id: 'V', assetId: asset.id, trackId, start: 0, duration: FPS * 6, inPoint: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM }, color: { ...DEFAULT_COLOR } }
  return { clipId: clip.id, project: { ...base, settings: { ...base.settings, fps: FPS, width: 1080, height: 1920 }, assets: [asset], clips: [clip] } }
}

const flat = (items: readonly DrawItem[]): DrawItem[] => items.flatMap((i) => (i.kind === 'group' ? flat(i.children) : [i]))
const spaced = (s: string): string => s.split(/\s+/u).filter(Boolean).join(' ')

/** One template's case, with the text measure and sound library given (node passes a fake; the page its own). */
export function checkFindCase(template: HarnessStepSix, measure: TextMeasure, sounds: SoundPack): FindCase {
  const out: FindCase = { template, offered: [], placed: 0, data: null, beats: [], seconds: null, strings: [], missing: [], sounds: 0, notes: [], dropped: [], error: null, pass: false }
  try {
    const { project, clipId } = findProject()
    const run = harnessStepSixRun(project, clipId, template, { sounds })
    out.offered = run.offered
    out.placed = run.placed.length
    out.notes = run.problems
    out.dropped = run.problems.filter((m) => m.startsWith('graphic dropped'))
    const g = run.project.clips.find((c) => c.id === run.placed[0])!
    const spec = g.graphic!
    out.data = spec.data
    out.beats = [...spec.beats]
    out.seconds = spec.seconds
    out.sounds = run.project.clips.filter((c) => c.forGraphic === g.id).length
    const style = graphicStyleOf(run.project, spec)
    const frame = graphicMovingFrames(spec, style, FPS, g.duration) - 1
    const size = { width: run.project.settings.width, height: run.project.settings.height }
    const drawn = spaced(flat(drawListAt(spec, style, frame, FPS, size, measure, {}).items).filter((i): i is TextItem => i.kind === 'text').map((i) => i.text).join(' '))
    out.strings = drawnStrings(spec.data).filter((s) => s.trim() !== '')
    out.missing = out.strings.filter((s) => !drawn.includes(spaced(s)))
    const elements = spec.data.template === 'timeline' ? spec.data.items.length : 2
    out.pass = out.placed === 1 && out.missing.length === 0 && out.beats.length === elements && out.dropped.length === 0
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
  }
  return out
}

/** The `find` option: each asked template's case, in the order asked, and a line each for the summary. */
export function checkFind(asked: readonly string[], measure: TextMeasure, summary: string[], notes: string[]): FindResult {
  const { catalog, root } = useCatalog.getState()
  const sounds = soundPackFor(catalog, root)
  const unknown = asked.filter((id) => !(HARNESS_STEP_SIX as readonly string[]).includes(id))
  const cases = asked.filter((id): id is HarnessStepSix => (HARNESS_STEP_SIX as readonly string[]).includes(id)).map((id) => checkFindCase(id, measure, sounds))
  for (const c of cases) {
    summary.push(
      `find ${c.template}: ${c.pass ? 'PASS' : 'FAIL'}; offered ${c.offered.filter((id) => (HARNESS_STEP_SIX as readonly string[]).includes(id)).join(', ') || 'none of the three'}; ` +
        `placed ${c.placed}, ${c.beats.length} beats (${c.beats.map((b) => b.toFixed(2)).join(', ')} s), ${c.seconds === null ? '—' : c.seconds.toFixed(2)} s on screen, ` +
        `${c.strings.length - c.missing.length} of ${c.strings.length} strings drawn, ${c.sounds} sound${c.sounds === 1 ? '' : 's'}` +
        (c.error ? `; ${c.error}` : '') +
        (c.notes.length > 0 ? `; notes: ${c.notes.join('; ')}` : '')
    )
  }
  if (unknown.length > 0) notes.push(`find: NOT READ, ${unknown.map((id) => JSON.stringify(id)).join(', ')}: the find option takes ${HARNESS_STEP_SIX.join(', ')}.`)
  if (asked.length === 0) notes.push(`find: no template named; name some of ${HARNESS_STEP_SIX.join(', ')}.`)
  return { cases, unknown }
}
