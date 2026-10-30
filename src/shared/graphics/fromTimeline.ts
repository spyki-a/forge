import type { Project } from '../timeline'
import { clipsOnTrack, framesToSeconds, projectDuration, secondsToFrames } from '../timeline'
import { groupWords } from '../captions/ass'
import { captionSpec } from '../captions/line'
import { resolveStyle, type CaptionStyle, type StyleOverrides } from '../captions/style'
import type { CaptionLayer, CaptionLayersSpec } from './spec'
import { captionTrack } from '../captions/timeline'
import { smartPlacement } from '../captions/smart'
import type { CaptionRoute } from '../captions/placement'
import { shapedScript } from '../render/textAnimation'
import { indicFontsFor } from '../render/textPaint'

/**
 * Compile a timeline into a graphics spec for the frame server.
 *
 * Only the captions `captionRoute` sends to the canvas end up here: a look ASS
 * cannot draw, or a track whose words hold a shaped script, which the 2018
 * Windows build's libass draws unshaped (docs/CLIPS.md §16.66 (a)). Every other
 * track stays on tier 1, where libass renders it during the normal encode at
 * no extra cost. See docs/research/architecture-plan-2026-09-11.md §3b.
 */

export interface GraphicsBuildOptions {
  width: number
  height: number
}

/**
 * True when the project needs the frame server at all.
 *
 * Deliberately a property of the request rather than of the feature: "captions"
 * is not a tier, *these* captions with *these* options are.
 */
export function needsFrameServer(_project: Project): boolean {
  /*
   * Nothing does, any more.
   *
   * Captions were the only thing that ever went to the offscreen browser, and
   * they are baked in the renderer now — one pass instead of two, and no
   * `capturePage()` per frame. Kept as a function rather than deleted because
   * the frame server itself still works and is where a future graphics layer
   * that genuinely needs a DOM would go; what changed is that captions are not
   * that thing. See docs/EFFECTS.md §13.
   */
  return false
}

/** Whether these captions have to be drawn rather than burned in by libass (`captionRoute`). */
export function captionsNeedBaking(project: Project): boolean {
  if (!project.captions?.enabled) return false
  if (Object.keys(project.transcripts).length === 0) return false
  return captionRoute(project).route === 'canvas'
}

/** Which export route a project's captions take, and why (`captionRoute`). */
export interface CaptionRouting {
  route: CaptionRoute
  /** The words the captions would show hold a script that joins or reorders (`shapedScript`). */
  shaped: boolean
  /** They hold Devanagari or Telugu (`indicFontsFor`): the two scripts measured unshaped on the Windows build's libass. */
  indic: boolean
}

/**
 * The route for the whole caption track, asked by the export, the preview's
 * placement and the OUTPUT strip alike (docs/CLIPS.md §6.20, §16.66 (a)).
 *
 * The canvas when the style needs one (`captionNeedsCanvas`, the style's half)
 * or when the words the captions would show (`captionWords`, over every clip
 * on the caption track and only inside each clip's window) hold a shaped
 * script (`shapedScript`, D8's one script rule): the 2018 Windows build's
 * libass draws Devanagari and Telugu unshaped, measured (EFFECTS.md §61), and
 * the bake shapes through Chromium's HarfBuzz on both machines. The whole
 * track, never per word or per line: libass draws a face at about 0.57× the
 * painter's size (EFFECTS.md §60), so a split track would change size
 * mid-line. Not the transcript's `language`, which a mixed or mislabelled
 * transcript would get wrong.
 */
export function captionRoute(project: Project): CaptionRouting {
  const style = resolveStyle(
    project.captions.styleId,
    project.captions.overrides as StyleOverrides | undefined
  )
  const words = captionWords(project)
  const shaped = shapedScript(words)
  const indic = indicFontsFor(words).length > 0
  return { route: captionNeedsCanvas(style) || shaped ? 'canvas' : 'libass', shaped, indic }
}

/**
 * What the failed or empty bake's fallback says: the captions are burned in
 * plain by libass instead. On Windows, for a Devanagari or Telugu track, also
 * that they come out unshaped, their letters not joined: the 2018 build's
 * libass is measured not to shape those two (EFFECTS.md §61). Every other case
 * keeps the plain words, a shaped script not measured on Windows included
 * (an Arabic line may join there even so), and the Mac's libass shapes both
 * (EFFECTS.md §51). `platform` is `navigator.platform` ('Win32', 'MacIntel').
 */
export function captionBakeFailedNotice(routing: CaptionRouting, platform: string, reason: string): string {
  if (routing.indic && /^win/i.test(platform)) {
    return `Captions could not be drawn, so they will be burned in plain and unshaped, their letters not joined: ${reason}`
  }
  return `Captions could not be drawn, so they will be burned in plain: ${reason}`
}

/**
 * The bake, and its fallback, as one step (docs/CLIPS.md §6.20).
 *
 * The overlay the bake made, or undefined, which sends the export to main
 * with no overlay, so main burns the track in with libass (`captionsForExport`):
 * a failed export is worse than plain captions. A bake that throws is said
 * (`captionBakeFailedNotice`); so is one that drew nothing on a shaped track,
 * since that too reaches libass, unshaped on Windows. Nothing drawn on an
 * unshaped track gives no overlay silently, as it always has. Pure but for the
 * two functions it is handed: `bakeCaptions` and the strip's `notify` in the
 * app.
 */
export async function captionBakeOrFallback<T>(
  routing: CaptionRouting,
  platform: string,
  bake: () => Promise<T | null>,
  notify: (message: string) => void
): Promise<T | undefined> {
  let baked: T | null
  try {
    baked = await bake()
  } catch (err) {
    notify(captionBakeFailedNotice(routing, platform, err instanceof Error ? err.message : String(err)))
    return undefined
  }
  if (baked) return baked
  if (routing.shaped) notify(captionBakeFailedNotice(routing, platform, 'nothing was drawn'))
  return undefined
}

/**
 * Whether these captions have to be drawn rather than burned in.
 *
 * ASS is genuinely cheaper — libass runs inside the normal encode and costs
 * nothing extra — so it stays the answer for anything it can actually express.
 * What it cannot express is a gradient or metallic fill, a glow, an extrusion, a
 * highlight block, and any per-word easing: karaoke tags recolour but cannot
 * scale, and there is no timing curve to reach.
 */
export function captionNeedsCanvas(style: CaptionStyle): boolean {
  return (
    style.animated === true ||
    style.textStyleId !== undefined ||
    style.animationId !== undefined
  )
}

/**
 * Caption layers, one per LINE.
 *
 * This used to emit one layer per word, each placed by guessing that a word is
 * about 2.2 font sizes wide — which is not true of any real font, and left the
 * spacing of every caption slightly wrong in a way no amount of style work could
 * fix. A line is now one layer carrying a text spec, and the page measures and
 * lays it out with the same painter the rest of the app uses. The per-word part
 * that genuinely varies — which word is lit — survives as `wordFrames`.
 */
export function buildCaptionLayers(
  project: Project,
  options: GraphicsBuildOptions
): CaptionLayersSpec | null {
  const fps = project.settings.fps
  const style = resolveStyle(
    project.captions.styleId,
    project.captions.overrides as StyleOverrides | undefined
  )

  // The same track the burned-in path builds from, so the two cannot disagree.
  const videoTrack = captionTrack(project)
  if (!videoTrack) return null
  /*
   * Smart placement (docs/CLIPS.md §5.4): the third each line takes, from the
   * same lookup the libass route is handed (captions/smart.ts), asked at the
   * layer's startFrame — the frame the line appears on, so a line spanning a
   * cut takes the shot where it starts (§5.2 rule 4). Null when placement is
   * the style's: every spec below is then what it always was.
   */
  const placement = smartPlacement(project, style, { width: options.width, height: options.height })

  const layers: CaptionLayer[] = []

  for (const clip of clipsOnTrack(project, videoTrack.id)) {
    const transcript = project.transcripts[clip.assetId]
    if (!transcript) continue

    const clipStartMs = framesToSeconds(clip.inPoint, fps) * 1000
    const clipEndMs = clipStartMs + framesToSeconds(clip.duration, fps) * 1000
    /*
     * Source ms -> timeline frames, through where the clip actually SITS.
     *
     * This used to accumulate durations into a running cursor, which equals
     * `clip.start` only while every clip is packed against its neighbour from
     * zero. One gap and every caption after it drifts.
     */
    const at = (ms: number): number =>
      clip.start + secondsToFrames((ms - clipStartMs) / 1000, fps)

    for (const group of groupWords(transcript.segments, transcript.words, style.wordsPerLine)) {
      // A line the clip does not actually show is not a line.
      const visible = group.filter((w) => w.endMs > clipStartMs && w.startMs < clipEndMs)
      if (visible.length === 0) continue

      const startFrame = Math.max(clip.start, at(visible[0].startMs))
      const endFrame = Math.min(
        clip.start + clip.duration,
        at(visible[visible.length - 1].endMs)
      )
      if (endFrame <= startFrame) continue

      layers.push({
        id: `cap-${clip.id}-${visible[0].index}`,
        kind: 'caption',
        startFrame,
        endFrame,
        // The highlight is left off: it moves, so the page sets it per frame.
        spec: captionSpec(style, visible, -1, placement ? placement(startFrame) : null),
        wordFrames: visible.map((w) => at(w.startMs)),
        highlight: { color: style.highlightColor, scale: style.highlightScale }
      })
    }
  }

  if (layers.length === 0) return null

  return {
    width: options.width,
    height: options.height,
    fps,
    /*
     * The EDIT's end, not the last caption's.
     *
     * The bake is planned over this many frames and overlaid with
     * `shortest=1`, so it has to be at least as long as the video: planned to
     * the last line's end, it stopped the whole export where the speech did —
     * a 30-frame clip captioned over frames 0–7 exported 10 frames, and a
     * marked range starting after the last caption came out with no video at
     * all. `projectDuration` is the end the render plan runs to, so the two
     * agree with or without a range (EFFECTS.md §43). The frames after the
     * last line are the blank, which is already a picture: nothing more drawn.
     */
    durationFrames: Math.max(projectDuration(project), ...layers.map((l) => l.endFrame)),
    layers
  }
}

/**
 * The words the captions would show, joined by spaces.
 *
 * Gathered as `buildCaptionLayers` reads them: each clip on `captionTrack`,
 * its transcript's words through `groupWords` (so a word outside every
 * segment, which no line shows, is not here either), only those inside the
 * clip's window. So a word the clip trims away is not here. The preview's
 * caption font effect asks `indicFontsFor` over this for the Hindi or Telugu
 * face a track needs (`captionFaces`, docs/CLIPS.md §6.20), and `captionRoute`
 * asks `shapedScript` over it for the track's route.
 */
export function captionWords(project: Project): string {
  const track = captionTrack(project)
  if (!track) return ''
  const fps = project.settings.fps
  const words: string[] = []
  for (const clip of clipsOnTrack(project, track.id)) {
    const transcript = project.transcripts[clip.assetId]
    if (!transcript) continue
    const clipStartMs = framesToSeconds(clip.inPoint, fps) * 1000
    const clipEndMs = clipStartMs + framesToSeconds(clip.duration, fps) * 1000
    // One word a group: the grouping's membership, not its line length.
    for (const [word] of groupWords(transcript.segments, transcript.words, 1)) {
      if (word.endMs > clipStartMs && word.startMs < clipEndMs) words.push(word.text)
    }
  }
  return words.join(' ')
}

export function captionStyleIsAnimated(style: CaptionStyle): boolean {
  return style.animated === true
}
