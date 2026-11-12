/**
 * Landing a run's graphics on the project, and taking them off again
 * (docs/CLIPS.md §6.6 "The rules", §6.14): `applyGraphics`, the app's own
 * lower third (`lowerThirdFor`), and the clips flow's Clear
 * (`clearGraphics`). Direct's Clear is `clearDirector` (director/apply.ts),
 * whose `DIRECTOR_RULES` hold `GRAPHIC_RULE`; this file's rule,
 * `CLIPS_GRAPHIC_RULE`, is never one of them.
 *
 * Pure and node-runnable: no DOM, no `node:path`; no clock or random but the
 * default id maker's, which a caller replaces (`ctx.newId`).
 */

import type { Clip, MediaAsset, Project } from '../timeline'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM } from '../timeline'
import type { ApplyContext } from '../director/apply'
import type { Problem } from '../director/conforms'
import { momentSeed } from '../director/apply2'
import type { SoundPack } from '../director/soundRoles'
import { drawsItself } from '../edit/recipes'
import { firstShownWord } from '../captions/placement'
import type { Transcript } from '../transcript'
import { RETIMED_NOTE, graphicBeats, graphicTiming } from './beats'
import { applyBudget, type BudgetCandidate } from './budget'
import { graphicClipAsset, graphicExitKeys } from './frame'
import { NO_CLIP_NOTE, NO_FREE_THIRD_NOTE, graphicLane, placeGraphic, subjectAtOnset, thirdPreference } from './place'
import { GRAPHIC_SOUND_LANE_NAME, NO_SOUND_LIBRARY_NOTE, footageOf, graphicSoundFiles, graphicSounds } from './sound'
import { CLEAN_GRAPHIC_STYLE } from './style'
import { GRAPHIC_TEMPLATES, type GraphicData, type GraphicDrop, type GraphicSpec, type KeptGraphic } from './template'
import type { GraphicProposal } from '../timeline'

/**
 * The clips flow's graphics rule (docs/CLIPS.md §6.6): the `generatedBy` of
 * every graphic a clips run lands, and what its Clear takes. It lives here,
 * outside the Director, so the Director's rules and Clear never see it.
 */
export const CLIPS_GRAPHIC_RULE = 'clips.graphic'

/**
 * Clear graphics' note (docs/CLIPS.md §6.6), the plan's words exactly, with
 * straight apostrophes inside a double-quoted string so a caller can drop it
 * into JSX or a test without escaping.
 */
export const CLEAR_GRAPHICS_NOTE = "Direct's graphics stay; Direct's Clear takes them"

/** A graphic whose transcript is not in the project cannot be timed (not §6's words; the plan is silent). */
export const NO_TRANSCRIPT_NOTE = 'its transcript is not in the project'

/** A template with no row in GRAPHIC_TEMPLATES is not drawn yet (not §6's words; the plan is silent). */
export const NOT_DRAWN_NOTE = 'that kind of graphic is not drawn yet'

/**
 * A kept graphic whose words are from another file than the clip it sits on
 * (`KeptGraphic.assetId` is not the footage clip's `assetId`): its beats would
 * be read from words the clip does not show (not §6's words; the plan is
 * silent, so it is dropped rather than drawn on the wrong words).
 */
export const WRONG_ASSET_NOTE = 'its words are from another file than the clip it sits on'

/** The run's rate is not the project's: every frame would be off, so nothing lands (not §6's words; the plan is silent). */
export function fpsMismatchNote(runFps: number, projectFps: number): string {
  return `graphics not placed: the run's frame rate (${runFps}) is not the project's (${projectFps})`
}

/** The proposal's mark (§6.6, "What is placed without review"): shown beside the words it heard. */
export const CHECK_THE_NUMBER = 'check the number'

/** Why the app placed a lower third (the clip's reason): the speaker's name on the first word the clip shows (§6.8). */
export const LOWER_THIRD_WHY = 'the speaker’s name, on the first word the clip shows'

/**
 * `applyGraphics`' context: the plan's `Pick<ApplyContext, 'fps' | 'newId'>`
 * and, beyond the plan's words, the sound library, as the spine's apply takes
 * it (`ApplyContext2.sounds`, director/apply2.ts): the store reads it with
 * `soundPackFor` and a pure function cannot. Absent, graphics land silent
 * with §6.14's one note. `fps` is the project's rate (the store passes
 * `project.settings.fps`, as it does to the spine's apply); a run whose `fps`
 * is not `project.settings.fps` lands nothing, with `fpsMismatchNote`, since
 * every reader under it (the captions' offset, placement, the sounds) counts
 * in the project's frames.
 */
export type GraphicsApplyContext = Pick<ApplyContext, 'fps' | 'newId'> & { sounds?: SoundPack }

const defaultId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/**
 * The strings a graphic draws, as its data holds them, the template's fixed
 * glyphs not read: the text `readingSeconds` counts (§6.2's reading hold),
 * joined by spaces by `drawnText`.
 */
export function drawnStrings(d: GraphicData): string[] {
  switch (d.template) {
    case 'counter':
    case 'ring':
      return [d.value, d.label]
    case 'bars':
      return [d.title, ...d.items.flatMap((i) => [i.label, i.value])]
    case 'steps':
      return [d.title, ...d.items.map((i) => i.label)]
    case 'quote':
      return d.kind === 'social' ? [d.text, d.name, d.handle, d.date] : [d.text, d.speaker]
    case 'callout':
      return [d.label]
    case 'keyword':
      return [d.words]
    case 'lower-third':
      return [d.name, d.role]
    default:
      return []
  }
}

/** `drawnStrings` joined by spaces, as graphicHolds' and specs.json's note count it. */
export function drawnText(d: GraphicData): string {
  return drawnStrings(d).join(' ')
}

/** A template as a note says it: "lower third", not "lower-third". */
function cardName(template: string): string {
  return template.replace(/-/g, ' ')
}

/** How a dropped graphic is named in a note: its kind and the first thing it draws. */
function nameOf(d: GraphicData): string {
  const head = drawnStrings(d).find((s) => s.trim() !== '')
  return head === undefined ? `the ${cardName(d.template)}` : `the ${cardName(d.template)} "${head}"`
}

/* --------------------------------------------------------- the lower third */

/**
 * The app's lower third on the footage clip `clip` (docs/CLIPS.md §6.6, §6.8):
 * the asset's Speaker (`MediaAsset.speaker`) as the name, drawn exactly as it
 * is held, and an empty role (the user types one in the dock); its beat the
 * first word of the asset's transcript that the clip shows (`firstShownWord`,
 * the captions' own test). `applyGraphics` calls it first on each covered
 * clip, so it carries the run's rule.
 *
 * Null without a Speaker (absent, or only spaces), without a transcript or a
 * word the clip shows, and when a lower third already stands over the clip
 * (a graphic clip whose template is `lower-third` and whose footage clip,
 * `footageOf`, is this one, whatever its rule).
 *
 * The candidate is the app's, not the model's: `source: 'baseline'` (the
 * type's only other value), no `proposal` (a lower third is placed without
 * review: its text is yours), `bound` empty (it claims nothing), its
 * `sentence` the transcript segment that holds the word.
 */
export function lowerThirdFor(project: Project, clip: Clip): KeptGraphic | null {
  const asset = project.assets.find((a) => a.id === clip.assetId)
  // Drawn trimmed, as a said quote's speaker is (settleGraphics), so setSpeaker finds both by one name.
  const name = asset?.speaker?.trim()
  if (name === undefined || name === '') return null
  const transcript = project.transcripts[clip.assetId]
  if (!transcript) return null
  const already = project.clips.some((c) => c.graphic?.data.template === 'lower-third' && footageOf(project, c, c.graphic) === clip.id)
  if (already) return null
  const word = firstShownWord(transcript.words, clip, project.settings.fps)
  if (!word) return null
  const segment = transcript.segments.find((s) => s.wordStart <= word.index && word.index <= s.wordEnd)
  return {
    clipId: clip.id,
    assetId: clip.assetId,
    candidate: {
      sentence: segment?.id ?? '',
      data: { template: 'lower-third', name, role: '' },
      bound: [],
      beatWords: [word.index],
      why: LOWER_THIRD_WHY,
      source: 'baseline'
    }
  }
}

/* ---------------------------------------------------------------- applying */

/** One graphic through the beats and the seconds (§6.6's landing order, steps 2-3). */
interface Timed extends BudgetCandidate {
  path: string
  kept: KeptGraphic
  seconds: number
  spec: GraphicSpec
}

/** The words a proposal heard (§6.6): those bound to its claims, else what it draws. */
function heardOf(kept: KeptGraphic, transcript: Pick<Transcript, 'words'>): string {
  const byIndex = new Map(transcript.words.map((w) => [w.index, w.text]))
  const heard = kept.candidate.bound.map((i) => byIndex.get(i)).filter((t): t is string => t !== undefined)
  return heard.length > 0 ? heard.join(' ') : drawnText(kept.candidate.data)
}

/**
 * Lands a run's kept graphics on the project (docs/CLIPS.md §6.6, "The
 * rules"), in the plan's order, each step reading the project as the steps
 * before it left it:
 *
 * 1. **The lower third**: `lowerThirdFor` on each `covered` clip (once per
 *    clip id), first, so it carries the run's `rule`.
 * 2. **The beats** (§6.8): `graphicBeats` over the transcript of the kept
 *    graphic's `assetId`, spread unless it is a quote. A retimed clip
 *    (`graphicBeats` null) drops every graphic on it, with ONE problem per
 *    clip (`RETIMED_NOTE`).
 * 3. **The seconds and the start** (§6.2, §6.8): `graphicTiming`, at
 *    the project's rate (`ctx.fps` must equal it); a graphic it refuses is dropped with its note.
 * 4. **Proposals set aside** (§6.6): a candidate with a `proposal` is not
 *    placed; it becomes a `GraphicProposal` (id `newId('graphic-proposal')`,
 *    `clipId` its footage clip, this run's `rule`, the note "check the
 *    number: heard "…"") appended to `Project.graphicProposals`. Its spec
 *    holds its timing (beats from the start it would have) and, as a
 *    placeholder until Keep places it (§6.9 at that moment), the template's
 *    first third. A lower third is never one.
 * 5. **The budget** (§6.9): `applyBudget` over the project's graphics and the
 *    rest; each drop a problem with the budget's reason.
 * 6. **Placement and the subject at onset** (§6.9), in the budget's onset
 *    order: `placeGraphic` on the output frame (`project.settings`' width and
 *    height, the canvas the store's bake and `rebakeGraphic` use), null
 *    dropped as "no free third"; then `subjectAtOnset`, a callout with no
 *    subject dropped with rule 9's note (`NO_SUBJECT_NOTE`) or the zoom's.
 * 7. **The lane** (§6.9): `graphicLane`, dropped at the track limit.
 * 8. **The sounds** (§6.14): `graphicSounds` on each landed graphic, under
 *    the run's rule, over `ctx.sounds`; its clips on their lanes, its new
 *    files in the pool, the sounds it re-places taken off first, and a file
 *    the app brought that no clip uses afterwards (one a re-placed sound
 *    stood on, or one this run added) taken out of the pool. Its notes, each
 *    once, are problems at `$.sounds`.
 *
 * Each graphic clip: id `newId('graphic')`; its asset `graphicClipAsset`, the
 * store's `addGraphicClip` call; keys `graphicExitKeys`; `generatedBy` the
 * run's rule and a reason that names the template, what it draws and why;
 * a spec with `grounding` (the kept graphic's asset, sentence and beat
 * words), `beats` from the clip's start, `place`, `subject` (null when not
 * taken), a seed from its start and landing index (`momentSeed`, the
 * spine's), `version` 1.
 *
 * Problems are `graphic dropped: <the graphic> — <reason>`, at `$.kept[i]`
 * or, for a lower third, `$.covered[j]`. `clipIds` are the graphic clips in
 * landing order (the budget's onset order), for the store's `rebakeGraphic`.
 * The input is never edited; with nothing to land the same project comes
 * back.
 */
export function applyGraphics(
  project: Project,
  kept: KeptGraphic[],
  covered: string[],
  rule: string,
  ctx: GraphicsApplyContext
): { project: Project; problems: Problem[]; clipIds: string[] } {
  const newId = ctx.newId ?? defaultId
  const fps = project.settings.fps
  if (ctx.fps !== fps) return { project, problems: [{ path: '$', message: fpsMismatchNote(ctx.fps, fps) }], clipIds: [] }
  const problems: Problem[] = []
  const drop = (path: string, data: GraphicData, reason: string): void => {
    problems.push({ path, message: `graphic dropped: ${nameOf(data)} — ${reason}` })
  }

  // 1. The lower third on each covered clip, first.
  const run: { path: string; kept: KeptGraphic }[] = []
  const seenCovered = new Set<string>()
  covered.forEach((id, j) => {
    if (seenCovered.has(id)) return
    seenCovered.add(id)
    const clip = project.clips.find((c) => c.id === id)
    const lower = clip ? lowerThirdFor(project, clip) : null
    if (lower) run.push({ path: `$.covered[${j}]`, kept: lower })
  })
  kept.forEach((k, i) => run.push({ path: `$.kept[${i}]`, kept: k }))

  // 2-3. The beats, the seconds and the start.
  const timed: Timed[] = []
  const retimed = new Set<string>()
  for (const { path, kept: k } of run) {
    const one = timeOne(project, path, k, rule)
    if ('timed' in one) timed.push(one.timed)
    else if ('retimed' in one) {
      // Once per clip (§6.8): every graphic on a retimed clip goes, with one note.
      if (!retimed.has(one.retimed)) problems.push({ path, message: `graphics dropped: ${RETIMED_NOTE}` })
      retimed.add(one.retimed)
    } else drop(path, k.candidate.data, one.reason)
  }

  // 4. Proposals set aside: not placed until Keep.
  const proposals: GraphicProposal[] = []
  const toPlace: Timed[] = []
  for (const t of timed) {
    if (t.spec.proposal) {
      const heard = heardOf(t.kept, project.transcripts[t.kept.assetId])
      proposals.push({ id: newId('graphic-proposal'), clipId: t.clipId, spec: { ...t.spec, seed: momentSeed(t.start, 0) }, rule, note: `${CHECK_THE_NUMBER}: heard "${heard}"` })
    } else toPlace.push(t)
  }

  // 5. The budget, over the project's graphics and the run's, the earlier winning.
  const budget = applyBudget(project, toPlace)
  for (const d of budget.dropped) {
    const t = toPlace.find((x) => x.spec === d.spec)!
    drop(t.path, t.spec.data, d.reason)
  }

  // 6-7. Placement, the subject at onset and the lane, in onset order; each graphic on the project before the next.
  const landed = landKept(project, budget.kept, rule, newId, (t, reason) => drop(t.path, t.spec.data, reason))
  let next = landed.project
  const clipIds = landed.clipIds

  // 8. The sounds, on each landed graphic; graphicSounds re-places every graphic sound on its footage clip.
  const sounded = soundsFor(next, clipIds, rule, ctx.sounds ?? [], newId)
  next = sounded.project
  for (const n of sounded.notes) problems.push({ path: '$.sounds', message: n })

  if (proposals.length > 0) next = { ...next, graphicProposals: [...(next.graphicProposals ?? []), ...proposals] }
  return { project: next, problems, clipIds }
}

/**
 * §6.6's landing steps 2-3 for one graphic (the beats, the seconds and the
 * start), shared by `applyGraphics` and `keepProposal`: the timed graphic,
 * or why it is dropped, or `{ retimed }` with its clip's id when the clip
 * is retimed (the caller says that once per clip).
 */
function timeOne(project: Project, path: string, k: KeptGraphic, rule: string): { timed: Timed } | { reason: string } | { retimed: string } {
  const fps = project.settings.fps
  const data = k.candidate.data
  const clip = project.clips.find((c) => c.id === k.clipId)
  if (!clip) return { reason: NO_CLIP_NOTE }
  const def = GRAPHIC_TEMPLATES[data.template]
  if (!def) return { reason: NOT_DRAWN_NOTE }
  if (k.assetId !== clip.assetId) return { reason: WRONG_ASSET_NOTE }
  const transcript = project.transcripts[k.assetId]
  if (!transcript) return { reason: NO_TRANSCRIPT_NOTE }
  const beats = graphicBeats(project, clip, transcript, k.candidate.beatWords, {
    spread: data.template !== 'quote'
  })
  if (beats === null) return { retimed: clip.id }
  const timing = graphicTiming(clip, beats, def, drawnText(data), fps)
  if (!timing.ok) return { reason: timing.note }
  const spec: GraphicSpec = {
    data,
    seconds: timing.seconds,
    beats: timing.beats,
    grounding: { assetId: k.assetId, sentence: k.candidate.sentence, words: [...k.candidate.beatWords] },
    // Chosen at step 6; the template's first third until then (a proposal keeps it until Keep places it).
    place: { auto: true, third: thirdPreference(data.template)[0] },
    seed: 0,
    version: 1,
    ...(k.candidate.proposal && data.template !== 'lower-third' ? { proposal: k.candidate.proposal } : {})
  }
  return { timed: { path, kept: k, clipId: clip.id, rule, start: timing.start, duration: timing.duration, seconds: timing.seconds, spec } }
}

/**
 * §6.6's landing steps 6-7 for graphics the budget kept, in its order, each
 * on the project before the next: placement (`placeGraphic`), the subject
 * at onset (`subjectAtOnset`), the lane (`graphicLane`) and the graphic clip
 * with its drawn asset. Shared by `applyGraphics` and `keepProposal`; a
 * graphic it cannot land goes to `drop` with its reason.
 */
function landKept(
  project: Project,
  kept: readonly Timed[],
  rule: string,
  newId: (prefix: string) => string,
  drop: (t: Timed, reason: string) => void
): { project: Project; clipIds: string[] } {
  const fps = project.settings.fps
  const canvas = { width: project.settings.width, height: project.settings.height }
  let next: Project = project
  const clipIds: string[] = []
  for (const t of kept) {
    const template = t.spec.data.template
    const place = placeGraphic(next, t.clipId, t.start, t.duration, template, canvas)
    if (!place) {
      drop(t, next.clips.some((c) => c.id === t.clipId) ? NO_FREE_THIRD_NOTE : NO_CLIP_NOTE)
      continue
    }
    const subject = subjectAtOnset(next, t.clipId, t.start, t.duration, template, canvas)
    if ('dropped' in subject) {
      drop(t, subject.dropped)
      continue
    }
    const lane = graphicLane(next, t.clipId, t.start, t.duration, rule)
    if ('dropped' in lane) {
      drop(t, lane.dropped)
      continue
    }
    next = lane.project
    const id = newId('graphic')
    const asset = graphicClipAsset(id, template, t.duration, { width: next.settings.width, height: next.settings.height, fps })
    const why = t.kept.candidate.why.trim()
    const clip: Clip = {
      id,
      assetId: asset.id,
      trackId: lane.trackId,
      start: t.start,
      duration: t.duration,
      inPoint: 0,
      volume: 1,
      transform: { ...DEFAULT_TRANSFORM },
      color: { ...DEFAULT_COLOR },
      // The exit is opacity keys over the clip's last 0.3 s (graphics/frame.ts), as addGraphicClip writes them.
      keyframes: graphicExitKeys(t.duration, fps),
      graphic: { ...t.spec, place, subject: subject.subject, seed: momentSeed(t.start, clipIds.length) },
      generatedBy: { rule, reason: `${nameOf(t.spec.data).replace(/^the /, '')}${why ? ` — ${why}` : ''}` }
    }
    next = { ...next, assets: [...next.assets, asset], clips: [...next.clips, clip] }
    clipIds.push(id)
  }
  return { project: next, clipIds }
}

/**
 * `applyGraphics`' drops, structured (beyond §6.6's words; lane T3 left them
 * as `Problem` text only, and the cheapest true fix is this reader, not a
 * change of `applyGraphics`' return): given the SAME `project`, `kept` and
 * `covered` that call was given, and its `problems`, each graphic it dropped
 * as `{ clipId, template, text, reason }`. A problem's path names the
 * graphic (`$.kept[i]`, or `$.covered[j]` for the lower third that
 * `lowerThirdFor` makes on the project as given); the reason is the message
 * after "graphic dropped: <the graphic> — ", rebuilt from the graphic's own
 * data, never split on a dash the graphic's words may hold. The one note a
 * retimed clip gets drops every graphic of the run on that clip, each one
 * here, once: a graphic already dropped for its own reason is not dropped
 * again for the retime. The sounds' notes and the frame-rate refusal drop no graphic and are
 * not here.
 */
export function graphicDropsOf(
  project: Project,
  kept: readonly KeptGraphic[],
  covered: readonly string[],
  problems: readonly Problem[]
): GraphicDrop[] {
  const run = new Map<string, KeptGraphic>()
  const seen = new Set<string>()
  covered.forEach((id, j) => {
    if (seen.has(id)) return
    seen.add(id)
    const clip = project.clips.find((c) => c.id === id)
    const lower = clip ? lowerThirdFor(project, clip) : null
    if (lower) run.set(`$.covered[${j}]`, lower)
  })
  kept.forEach((k, i) => run.set(`$.kept[${i}]`, k))
  const dropOf = (k: KeptGraphic, reason: string): GraphicDrop => ({
    clipId: k.clipId,
    template: k.candidate.data.template,
    text: drawnStrings(k.candidate.data).find((t) => t.trim() !== '') ?? '',
    reason
  })
  // A graphic dropped for its own reason is not dropped again for its clip's
  // retime, wherever in the problems either note stands.
  const own = new Set<KeptGraphic>()
  for (const p of problems) {
    const k = run.get(p.path)
    if (k && p.message.startsWith(`graphic dropped: ${nameOf(k.candidate.data)} — `)) own.add(k)
  }
  const out: GraphicDrop[] = []
  for (const p of problems) {
    const k = run.get(p.path)
    if (!k) continue
    const head = `graphic dropped: ${nameOf(k.candidate.data)} — `
    if (p.message.startsWith(head)) out.push(dropOf(k, p.message.slice(head.length)))
    else if (p.message === `graphics dropped: ${RETIMED_NOTE}`) {
      for (const other of run.values()) if (other.clipId === k.clipId && !own.has(other)) out.push(dropOf(other, RETIMED_NOTE))
    }
  }
  return out
}

/**
 * `graphicSounds` on each graphic clip of `graphicIds` in turn (each call
 * re-places every graphic sound on that graphic's footage clip), `rule` for
 * a graphic with no `generatedBy`; its clips on their lanes, its new files
 * in the pool, the sounds it re-places taken off first, and a file the app
 * brought that no clip uses afterwards (one a re-placed sound stood on, or
 * one this call added) taken out of the pool, as Clear's sweep would. Its
 * notes, each once.
 */
function soundsFor(
  project: Project,
  graphicIds: readonly string[],
  rule: string,
  sounds: SoundPack,
  newId: (prefix: string) => string
): { project: Project; notes: string[] } {
  let next = project
  const notes: string[] = []
  const mayGo = new Set<string>()
  for (const id of graphicIds) {
    const g = next.clips.find((c) => c.id === id)
    if (!g?.graphic) continue
    const out = graphicSounds(next, g, g.graphic, g.generatedBy?.rule ?? rule, sounds, { newId })
    for (const n of out.notes) if (!notes.includes(n)) notes.push(n)
    if (out.removed.length === 0 && out.clips.length === 0 && out.assets.length === 0 && out.tracks.length === 0) continue
    const gone = new Set(out.removed)
    for (const c of next.clips) if (gone.has(c.id)) mayGo.add(c.assetId)
    for (const a of out.assets) mayGo.add(a.id)
    next = {
      ...next,
      tracks: [...next.tracks, ...out.tracks],
      assets: [...next.assets, ...out.assets],
      clips: [...next.clips.filter((c) => !gone.has(c.id)), ...out.clips]
    }
  }
  if (mayGo.size > 0) {
    const used = new Set(next.clips.map((c) => c.assetId))
    next = { ...next, assets: next.assets.filter((a) => !(mayGo.has(a.id) && a.broughtBy !== undefined && !used.has(a.id))) }
  }
  return { project: next, notes }
}

/**
 * The sounds a Clear leaves out of place, put back (beyond §6.14's words).
 * The cap is per footage clip over every graphic on it (`graphicSounds`), so
 * a run of one rule can push out another rule's graphic's sounds: a Clip-it
 * run over a Direct keyword takes the keyword's three sound slots, and Clear
 * graphics then takes the Clip-it graphics and their sounds and leaves the
 * keyword silent. Called with the project before a Clear (`clearGraphics`
 * or `clearDirector`) and the one it returned, it re-places the sounds of
 * every footage clip the Clear took a graphic from and that still holds a
 * graphic of an app rule (`generatedBy` set), through `graphicSounds`, so
 * they are again a function of the footage clip's graphics. A footage clip
 * left with only graphics of yours (no `generatedBy`) is not touched: a Clear
 * never gives your graphics sounds. The store calls it inside the Clear's
 * own undo step, with the pack it reads (`soundPackFor`); `after` comes back
 * as the same object when there is nothing to re-place.
 */
export function resoundAfterClear(
  before: Project,
  after: Project,
  sounds: SoundPack,
  options: { newId?: (prefix: string) => string } = {}
): { project: Project; notes: string[] } {
  const still = new Set(after.clips.map((c) => c.id))
  const touched = new Set<string>()
  for (const g of before.clips) {
    if (!g.graphic || still.has(g.id)) continue
    const f = footageOf(before, g, g.graphic)
    if (f !== null && still.has(f)) touched.add(f)
  }
  const pick: string[] = []
  for (const f of touched) {
    const g = after.clips.find((c) => c.graphic && c.generatedBy !== undefined && footageOf(after, c, c.graphic) === f)
    if (g) pick.push(g.id)
  }
  if (pick.length === 0) return { project: after, notes: [] }
  return soundsFor(after, pick, CLIPS_GRAPHIC_RULE, sounds, options.newId ?? defaultId)
}

/* ------------------------------------------------------------------- clear */

/**
 * The clips flow's Clear graphics (docs/CLIPS.md §6.6, §6.14), one returned
 * project, so one undo step in the store:
 *
 * - every clip of `CLIPS_GRAPHIC_RULE` (its graphic clips and their sounds,
 *   which carry the graphic's rule) and every clip whose `forGraphic` is one
 *   of those graphics;
 * - of the assets those clips stood on, every one that is a drawn graphic
 *   asset (its clip draws itself) or has a `broughtBy`, when no surviving
 *   clip uses it; a file you imported has no `broughtBy` and stays;
 * - the `CLIPS_GRAPHIC_RULE` proposals;
 * - an audio track named "Graphic sounds", not the Director's, that this
 *   Clear empties. As `clearDirector` takes the `director` track it emptied,
 *   but read narrower: "Graphic sounds" is an ordinary track (§6.14) a user
 *   may have made or put a clip on, so only one that held a removed clip and
 *   now holds none goes. A graphic's video lane is not marked (§6.9) and
 *   stays, as an ordinary track does. A project is never left without a
 *   track of either kind it had.
 *
 * Direct's graphics stay (`CLEAR_GRAPHICS_NOTE`); Direct's Clear takes them.
 * The same project comes back when there is nothing to take.
 */
export function clearGraphics(project: Project): Project {
  return clearRuleGraphics(
    project,
    (c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE,
    (g) => g.rule === CLIPS_GRAPHIC_RULE
  )
}

/**
 * Find again's clear (docs/CLIPS.md §6.6, "Find again replaces the clip's
 * 'clips.graphic' graphics, their sounds and its pending proposals"):
 * `clearGraphics`' body over ONE footage clip: the `CLIPS_GRAPHIC_RULE`
 * graphic clips whose footage clip (`footageOf`, the sounds' own reading)
 * is `clipId`, every clip that follows one of them (`forGraphic`), their
 * drawn assets and brought files no survivor uses, the `CLIPS_GRAPHIC_RULE`
 * proposals on `clipId`, and a "Graphic sounds" track this emptied. Another
 * clip's graphics, Direct's graphics and your own stay. The same project
 * comes back when there is nothing to take.
 */
export function clearClipGraphics(project: Project, clipId: string): Project {
  return clearRuleGraphics(
    project,
    (c) => c.graphic !== undefined && c.generatedBy?.rule === CLIPS_GRAPHIC_RULE && footageOf(project, c, c.graphic) === clipId,
    (g) => g.rule === CLIPS_GRAPHIC_RULE && g.clipId === clipId
  )
}

/**
 * The one body of `clearGraphics` and `clearClipGraphics`: the clips `taken`
 * picks, every clip that follows a graphic among them, the proposals
 * `proposalTaken` picks, and the sweep described on `clearGraphics`.
 */
function clearRuleGraphics(
  project: Project,
  taken: (c: Clip) => boolean,
  proposalTaken: (g: GraphicProposal) => boolean
): Project {
  const graphicIds = new Set(project.clips.filter((c) => taken(c) && c.graphic).map((c) => c.id))
  const removed = project.clips.filter((c) => taken(c) || (c.forGraphic !== undefined && graphicIds.has(c.forGraphic)))
  const proposals = project.graphicProposals?.filter((g) => !proposalTaken(g))
  const proposalsGone = proposals !== undefined && proposals.length !== project.graphicProposals!.length
  if (removed.length === 0 && !proposalsGone) return project

  const gone = new Set(removed.map((c) => c.id))
  const survivors = project.clips.filter((c) => !gone.has(c.id))
  const stillUsed = new Set(survivors.map((c) => c.assetId))
  const assetById = new Map<string, MediaAsset>(project.assets.map((a) => [a.id, a]))
  const ours = new Set(
    removed.filter((c) => drawsItself(c) || assetById.get(c.assetId)?.broughtBy !== undefined).map((c) => c.assetId)
  )
  const emptied = new Set(
    project.tracks
      .filter(
        (t) =>
          t.kind === 'audio' &&
          !t.director &&
          t.name === GRAPHIC_SOUND_LANE_NAME &&
          removed.some((c) => c.trackId === t.id) &&
          !survivors.some((c) => c.trackId === t.id)
      )
      .map((t) => t.id)
  )
  const tracks = project.tracks.filter((t) => !emptied.has(t.id))
  return {
    ...project,
    tracks: tracks.some((t) => t.kind === 'audio') || !project.tracks.some((t) => t.kind === 'audio') ? tracks : project.tracks,
    clips: survivors,
    assets: project.assets.filter((a) => !(ours.has(a.id) && !stillUsed.has(a.id))),
    ...(proposals !== undefined ? { graphicProposals: proposals } : {})
  }
}

/* ------------------------------------------------- a graphic's sounds follow it */

/*
 * §6.14 "A graphic's sounds follow it" and "Off per project": the pure half
 * of the store's follow-on edits, so the store's removeClip, moveClip and
 * moveSelectionTo and lane T2b's dropGraphic and keepGraphic call the same
 * functions. A follower is matched by its `forGraphic`, never by its time.
 */

/** The clips that follow the graphic clips `ids`: those whose `forGraphic` is one of them (§6.14). */
export function graphicFollowers(project: Pick<Project, 'clips'>, ids: Iterable<string>): Clip[] {
  const graphics = new Set(ids)
  return project.clips.filter((c) => c.forGraphic !== undefined && graphics.has(c.forGraphic))
}

/**
 * Of the assets the clips `gone` stood on, those the app brought
 * (`broughtBy`) that no clip of `survivors` uses: Clear's sweep (§6.14), for
 * the files a graphic's sounds stood on. A file you imported carries no
 * `broughtBy` and stays; a graphic's drawn asset carries none either.
 */
function withoutUnusedBrought(project: Project, gone: readonly Clip[]): Project {
  if (gone.length === 0) return project
  const used = new Set(project.clips.map((c) => c.assetId))
  const stood = new Set(gone.map((c) => c.assetId))
  const assets = project.assets.filter((a) => !(stood.has(a.id) && a.broughtBy !== undefined && !used.has(a.id)))
  return assets.length === project.assets.length ? project : { ...project, assets }
}

/**
 * `removeClip` on a graphic, and T2b's `dropGraphic` (§6.14): the clips
 * `ids` (through `removeClips`, a plain filter by default; the store's
 * Delete passes `removeMany`), every clip that follows one of them
 * (`forGraphic`), and of the followers' files (those in `ids` too) those
 * the app brought that no surviving clip uses. A graphic's own drawn asset
 * stays in the pool, as `removeClip` has always left the asset of a clip it
 * removes (lane C's arm; an undo puts the clip back over it). The same
 * project comes back when nothing is removed.
 */
export function removeWithFollowers(
  project: Project,
  ids: readonly string[],
  removeClips: (project: Project, ids: readonly string[]) => Project = (p, gone) => {
    const set = new Set(gone)
    return p.clips.some((c) => set.has(c.id)) ? { ...p, clips: p.clips.filter((c) => !set.has(c.id)) } : p
  }
): Project {
  const going = new Set(ids)
  /*
   * Every follower of a graphic in `ids`, those in `ids` themselves included:
   * a graphic selected with its own sound (a marquee) takes the sound through
   * `removeClips`, and the file the sound brought must still go with it.
   */
  const followers = graphicFollowers(project, going)
  const removed = removeClips(project, ids)
  if (followers.length === 0) return removed
  const gone = new Set(followers.map((c) => c.id))
  const clips = removed.clips.some((c) => gone.has(c.id)) ? removed.clips.filter((c) => !gone.has(c.id)) : removed.clips
  return withoutUnusedBrought(clips === removed.clips ? removed : { ...removed, clips }, followers)
}

/**
 * `moveClip` and `moveSelectionTo` (§6.14): given the project `before` a
 * move and `after` it, and the ids of the clips in the move, every clip that
 * follows a graphic and is not in the move itself is shifted by its
 * graphic's own shift (`after`'s start less `before`'s), so its peak stays on
 * the frame of the graphic it was placed on. Beyond §6.14's words: a sound
 * shifted before frame 0 starts on 0, part-way into its file (its `inPoint`
 * up and its `duration` down by the frames cut), as `graphicSounds` places
 * one there, so its peak still lands on its frame; one with nothing left
 * after frame 0 is taken, with its brought file when unused; one standing on
 * 0 part-way in gets its head back on a later shift (no frames are lost to a
 * drag left and back). `after` comes
 * back as the same object when nothing follows.
 */
export function followGraphicMoves(before: Project, after: Project, moving: Iterable<string>): Project {
  const inMove = new Set(moving)
  const was = new Map(before.clips.map((c) => [c.id, c.start]))
  const shiftOf = new Map<string, number>()
  for (const c of after.clips) {
    if (!c.graphic) continue
    const from = was.get(c.id)
    if (from !== undefined && from !== c.start) shiftOf.set(c.id, c.start - from)
  }
  if (shiftOf.size === 0) return after
  const dropped: Clip[] = []
  let changed = false
  const clips: Clip[] = []
  for (const c of after.clips) {
    const shift = c.forGraphic === undefined || inMove.has(c.id) ? undefined : shiftOf.get(c.forGraphic)
    if (shift === undefined) {
      clips.push(c)
      continue
    }
    changed = true
    const start = c.start + shift
    /*
     * A sound standing on frame 0 part-way into its file (cut there by an
     * earlier step of the same drag, or placed there by graphicSounds) gets
     * its head back when its graphic moves later, up to the frames it was cut:
     * a drag left and back leaves the sound a fresh placement gives.
     */
    const back = shift > 0 && c.start === 0 && c.inPoint > 0 ? Math.min(c.inPoint, shift) : 0
    if (back > 0) {
      clips.push({ ...c, start: start - back, inPoint: c.inPoint - back, duration: c.duration + back })
      continue
    }
    if (start >= 0) {
      clips.push({ ...c, start })
      continue
    }
    // Frames, so integers: the cut is exact, no rounding.
    const cut = -start
    if (cut >= c.duration) {
      dropped.push(c)
      continue
    }
    clips.push({ ...c, start: 0, inPoint: c.inPoint + cut, duration: c.duration - cut })
  }
  if (!changed) return after
  return withoutUnusedBrought({ ...after, clips }, dropped)
}

/**
 * `setGraphicSounds(false)` (§6.14, "Off per project"): every clip with a
 * `forGraphic` off, the files they stood on that the app brought and no
 * surviving clip uses, and `Project.graphics.sound` false (with the `clean`
 * preset when the project had no graphics settings). Their lanes stay, so
 * `true` finds them again. The same project comes back when it is already off
 * and no clip follows a graphic.
 */
export function silenceGraphics(project: Project): Project {
  const followers = project.clips.filter((c) => c.forGraphic !== undefined)
  if (project.graphics?.sound === false && followers.length === 0) return project
  const gone = new Set(followers.map((c) => c.id))
  const next: Project = {
    ...project,
    graphics: { styleId: CLEAN_GRAPHIC_STYLE.id, ...project.graphics, sound: false },
    clips: project.clips.filter((c) => !gone.has(c.id))
  }
  return withoutUnusedBrought(next, followers)
}

/**
 * `setGraphicSounds(true)` (§6.14): `Project.graphics.sound` true, and the
 * sounds placed again for every graphic on the timeline through
 * `graphicSounds`, each under its own rule and on its own lane, the cap
 * counted afresh per footage clip in onset order. One call per footage clip
 * that holds a graphic of an app rule (`generatedBy` set; `graphicSounds`
 * places every graphic on it, yours under that graphic's rule, as a run
 * does), and one per such graphic over no footage, in onset order. A footage
 * clip with only graphics of yours gets none: no run placed sounds there, so
 * none come back (resoundAfterClear's rule). Already on (`true` or absent):
 * nothing, the same project.
 */
export function soundAllGraphics(
  project: Project,
  sounds: SoundPack,
  options: { newId?: (prefix: string) => string } = {}
): { project: Project; notes: string[] } {
  if (project.graphics?.sound !== false) return { project, notes: [] }
  const on: Project = { ...project, graphics: { ...project.graphics, sound: true } }
  const seen = new Set<string>()
  const pick: string[] = []
  const graphics = on.clips.filter((c) => c.graphic && c.generatedBy !== undefined).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))
  for (const g of graphics) {
    const key = footageOf(on, g, g.graphic!) ?? `alone:${g.id}`
    if (seen.has(key)) continue
    seen.add(key)
    pick.push(g.id)
  }
  return soundsFor(on, pick, CLIPS_GRAPHIC_RULE, sounds, options.newId ?? defaultId)
}

/**
 * Re-place one graphic's sounds (§6.14: "`setGraphic` and `keepGraphic`
 * re-place them"): its `forGraphic` clips off and placed again through
 * `graphicSounds`, which re-places every graphic sound on its footage clip
 * so the cap and the file index hold. Placed under the graphic's own rule;
 * a graphic of yours (no `generatedBy`) is re-placed under the rule of the
 * earliest app graphic on its footage clip, and when there is none it has no
 * sounds to re-place and the project comes back as it was (a run never
 * sounded it). With the sounds off, `graphicSounds` places nothing and takes
 * nothing. With no library, the graphic's own sounds are taken (they stood on
 * its old beats) and it lands silent, with §6.14's one note.
 */
export function resoundGraphic(
  project: Project,
  graphicId: string,
  sounds: SoundPack,
  options: { newId?: (prefix: string) => string } = {}
): { project: Project; notes: string[] } {
  const g = project.clips.find((c) => c.id === graphicId)
  if (!g?.graphic) return { project, notes: [] }
  /*
   * No library: nothing can be placed again, and graphicSounds then takes
   * nothing either. The graphic's own sounds stood on its old beats, so they
   * go (with their brought files when unused) and it lands silent, §6.14's
   * words for a graphic with no library. The other graphics' sounds on its
   * footage clip are still on their beats and stay.
   */
  const files = graphicSoundFiles(sounds)
  if (project.graphics?.sound !== false && files.tick.length === 0 && files.whoosh.length === 0) {
    const own = graphicFollowers(project, [graphicId])
    if (own.length > 0) {
      const gone = new Set(own.map((c) => c.id))
      return { project: withoutUnusedBrought({ ...project, clips: project.clips.filter((c) => !gone.has(c.id)) }, own), notes: [NO_SOUND_LIBRARY_NOTE] }
    }
  }
  let pick: Clip | undefined = g.generatedBy !== undefined ? g : undefined
  if (!pick) {
    const f = footageOf(project, g, g.graphic)
    if (f !== null) {
      pick = project.clips
        .filter((c) => c.graphic && c.generatedBy !== undefined && footageOf(project, c, c.graphic) === f)
        .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))[0]
    }
  }
  if (!pick) return { project, notes: [] }
  return soundsFor(project, [pick.id], CLIPS_GRAPHIC_RULE, sounds, options.newId ?? defaultId)
}

/* ------------------------------------------- Find, Keep, Drop, the Speaker */

/*
 * The pure half of the store's graphics actions (docs/CLIPS.md §6.6 "Store
 * actions", §6.9, §6.14), so the store's findGraphics, keepGraphic,
 * dropGraphic and setSpeaker and the rebake arms call code a node test runs.
 */

/**
 * Find (and Find again) landing on one footage clip, in one returned project
 * (§6.6, "Find again replaces the clip's 'clips.graphic' graphics, their
 * sounds and its pending proposals, in one undo step"): `clearClipGraphics`,
 * then `resoundAfterClear` (a graphic of another rule on the clip, Direct's,
 * gets back a sound slot the old run held), then `applyGraphics` under
 * `CLIPS_GRAPHIC_RULE` with `clipId` covered (the lower third). `cleared` is
 * the project `applyGraphics` was given, for `graphicDropsOf`.
 */
export function replaceClipGraphics(
  project: Project,
  clipId: string,
  kept: KeptGraphic[],
  ctx: GraphicsApplyContext
): { project: Project; problems: Problem[]; clipIds: string[]; cleared: Project } {
  const cleared = clearClipGraphics(project, clipId)
  const resounded = cleared === project ? cleared : resoundAfterClear(project, cleared, ctx.sounds ?? [], { newId: ctx.newId }).project
  const applied = applyGraphics(resounded, kept, [clipId], CLIPS_GRAPHIC_RULE, ctx)
  return { ...applied, cleared: resounded }
}

/** Keep on a proposal that is no longer listed (not §6's words; the plan is silent). */
export const PROPOSAL_GONE_NOTE = 'that graphic is no longer waiting for a check'

/**
 * Keep (docs/CLIPS.md §6.6 "Proposals live in", §6.9): ONE `GraphicProposal`
 * placed "through §6.9's placement and budget at that moment", by the steps
 * `applyGraphics` lands a graphic with, not a copy of them: the beats and
 * the seconds again on its footage clip as it is now (the proposal's
 * `grounding` holds its beat words; a `GraphicProposal` holds no start), the
 * budget (`applyBudget`) under the proposal's own rule, placement, the
 * subject at onset, the lane, the graphic clip, then its sounds (as
 * `resoundGraphic` places them). The placed graphic carries no `proposal`:
 * it is checked. The proposal leaves `Project.graphicProposals`.
 *
 * Refused (the budget, no free third, no subject for a callout, no lane, the
 * clip gone or retimed, the proposal gone, another rate): `refused` is the
 * reason, the project comes back as the same object and the proposal stays
 * listed.
 */
export function keepProposal(
  project: Project,
  proposalId: string,
  ctx: GraphicsApplyContext
): { project: Project; problems: Problem[]; clipIds: string[]; refused: string | null } {
  const refuse = (reason: string): { project: Project; problems: Problem[]; clipIds: string[]; refused: string } => ({ project, problems: [], clipIds: [], refused: reason })
  const fps = project.settings.fps
  if (ctx.fps !== fps) return refuse(fpsMismatchNote(ctx.fps, fps))
  const proposal = project.graphicProposals?.find((g) => g.id === proposalId)
  if (!proposal) return refuse(PROPOSAL_GONE_NOTE)
  const clip = project.clips.find((c) => c.id === proposal.clipId)
  if (!clip) return refuse(NO_CLIP_NOTE)
  const { spec } = proposal
  const kept: KeptGraphic = {
    clipId: proposal.clipId,
    assetId: spec.grounding?.assetId ?? clip.assetId,
    candidate: {
      sentence: spec.grounding?.sentence ?? '',
      data: spec.data,
      bound: [],
      beatWords: [...(spec.grounding?.words ?? [])],
      why: '',
      source: 'model'
    }
  }
  const one = timeOne(project, '$', kept, proposal.rule)
  if ('retimed' in one) return refuse(RETIMED_NOTE)
  if ('reason' in one) return refuse(one.reason)
  const budget = applyBudget(project, [one.timed])
  if (budget.dropped.length > 0) return refuse(budget.dropped[0].reason)
  let refusal: string | null = null
  const newId = ctx.newId ?? defaultId
  const landed = landKept(project, budget.kept, proposal.rule, newId, (_t, reason) => {
    refusal = reason
  })
  if (refusal !== null || landed.clipIds.length === 0) return refuse(refusal ?? NO_CLIP_NOTE)
  const sounded = soundsFor(landed.project, landed.clipIds, proposal.rule, ctx.sounds ?? [], newId)
  const next: Project = {
    ...sounded.project,
    graphicProposals: (sounded.project.graphicProposals ?? []).filter((g) => g.id !== proposalId)
  }
  return { project: next, problems: sounded.notes.map((message) => ({ path: '$.sounds', message })), clipIds: landed.clipIds, refused: null }
}

/**
 * Drop (docs/CLIPS.md §6.6, §6.14): on a graphic clip, the graphic, its drawn
 * asset when nothing else uses it, and its sounds with the files the app
 * brought for them when unused (`removeWithFollowers`), then the other
 * graphics' sounds on its footage clip put back under the cap
 * (`resoundAfterClear`). Nothing else: another graphic's sounds, your
 * imported files, the footage. On a proposal's id, the proposal leaves
 * `Project.graphicProposals` (Drop on a proposal "removes it"). The same
 * project comes back for an id that is neither.
 */
export function withoutGraphic(
  project: Project,
  id: string,
  sounds: SoundPack,
  options: { newId?: (prefix: string) => string } = {}
): { project: Project; notes: string[] } {
  if (project.graphicProposals?.some((g) => g.id === id)) {
    return { project: { ...project, graphicProposals: project.graphicProposals.filter((g) => g.id !== id) }, notes: [] }
  }
  const g = project.clips.find((c) => c.id === id)
  if (!g?.graphic) return { project, notes: [] }
  const removed = removeWithFollowers(project, [id])
  const unused = drawsItself(g) && !removed.clips.some((c) => c.assetId === g.assetId)
  const after = unused ? { ...removed, assets: removed.assets.filter((a) => a.id !== g.assetId) } : removed
  return resoundAfterClear(project, after, sounds, options)
}

/** The note when a graphic's auto third cannot be chosen again after an aspect change or a reframe (not §6's words). */
export function keptPlaceNote(d: GraphicData, reason: string): string {
  return `${nameOf(d)} keeps its old place — ${reason}`
}

/**
 * §6.9's `place.auto` recompute, on an aspect change or a reframe: a graphic
 * whose place is auto is placed again (`placeGraphic`, which reads the
 * subject's overlap over the span) over its footage clip as the project now
 * is. A box you dragged (`place.auto` false) is kept. The footage clip is
 * `footageOf`'s (the clip the subject names, else one of the grounding's
 * asset, else the bottom-most under the graphic's first frame), as the
 * sounds read it: a graphic stores no footage clip id when no subject was
 * taken.
 *
 * The subject at onset is kept as it was taken (beyond the plan's words,
 * which say the place is recomputed "with the subject at onset"): it is a
 * box in SOURCE units read once at onset (§6.9 step 4), which `graphicTargetsAt`
 * maps through the crop as it now is, so an aspect change or a reframe does
 * not move it; only whether the face is still on screen there could change,
 * and that is not read again here.
 *
 * When no third is left, it keeps its old place with `keptPlaceNote`,
 * rather than vanishing. `version` goes up when the place changed;
 * otherwise the same project comes back.
 */
export function placeAgain(project: Project, graphicId: string): { project: Project; note: string | null } {
  const g = project.clips.find((c) => c.id === graphicId)
  const spec = g?.graphic
  if (!g || !spec || !spec.place.auto) return { project, note: null }
  const footage = footageOf(project, g, spec)
  if (footage === null) return { project, note: null }
  const canvas = { width: project.settings.width, height: project.settings.height }
  const place = placeGraphic(project, footage, g.start, g.duration, spec.data.template, canvas)
  if (!place) return { project, note: keptPlaceNote(spec.data, NO_FREE_THIRD_NOTE) }
  if (place.auto && place.third === spec.place.third) return { project, note: null }
  const graphic: GraphicSpec = { ...spec, place, version: spec.version + 1 }
  return { project: { ...project, clips: project.clips.map((c) => (c.id === graphicId ? { ...c, graphic } : c)) }, note: null }
}

/**
 * The Transcript tile's Speaker (docs/CLIPS.md §6.6 "Speaker", §16.31):
 * `MediaAsset.speaker` set to `name`, trimmed (a name of only spaces is no Speaker:
 * the field goes), and every graphic of that asset (its `grounding`'s asset,
 * else its footage clip's) that drew the OLD name drawn with the new one:
 * a lower third's `name` that was the old Speaker, and a said quote's
 * `speaker` that was `quoteSpeakerFor`'s old answer (the Speaker, else a
 * link's channel) becomes its new answer. Each changed graphic's `version`
 * goes up; `changed` lists them for the store's rebake.
 *
 * An emptied Speaker leaves an existing lower third as it is (beyond the
 * plan's words: §6.6 says only that a lower third waits for a name; one
 * already placed keeps the name it drew, and Drop takes it), while a quote
 * goes to the channel, or ''. The same project comes back when nothing
 * changes.
 */
export function withSpeaker(project: Project, assetId: string, name: string): { project: Project; changed: string[] } {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return { project, changed: [] }
  // Stored trimmed: a lower third and a said quote both draw the trimmed name (lowerThirdFor, settleGraphics).
  const speaker = name.trim() === '' ? undefined : name.trim()
  if (speaker === asset.speaker) return { project, changed: [] }
  const { speaker: _old, ...rest } = asset
  const nextAsset: MediaAsset = speaker === undefined ? rest : { ...rest, speaker }
  const oldLower = asset.speaker !== undefined && asset.speaker.trim() !== '' ? asset.speaker.trim() : undefined
  const oldQuote = quoteSpeakerOf(asset)
  const newQuote = quoteSpeakerOf(nextAsset)
  const changed: string[] = []
  const clips = project.clips.map((c) => {
    const spec = c.graphic
    if (!spec) return c
    const owner = spec.grounding?.assetId ?? project.clips.find((f) => f.id === footageOf(project, c, spec))?.assetId
    if (owner !== assetId) return c
    const d = spec.data
    let data: GraphicData | null = null
    if (d.template === 'lower-third' && speaker !== undefined && oldLower !== undefined && d.name === oldLower) data = { ...d, name: speaker }
    if (d.template === 'quote' && d.kind !== 'social' && d.speaker === oldQuote && oldQuote !== newQuote) data = { ...d, speaker: newQuote }
    if (!data) return c
    changed.push(c.id)
    return { ...c, graphic: { ...spec, data, version: spec.version + 1 } }
  })
  return {
    project: { ...project, assets: project.assets.map((a) => (a.id === assetId ? nextAsset : a)), clips: changed.length > 0 ? clips : project.clips },
    changed
  }
}

/**
 * The name a said quote draws as its speaker for an asset (§6.6 "Speaker",
 * §16.31): its Speaker when it holds more than spaces, else a link's channel,
 * else '', trimmed (as settleGraphics draws it). director/run.ts `quoteSpeakerFor` returns this; it lives here so
 * `withSpeaker` reads the same rule without graphics/ importing the run.
 */
export function quoteSpeakerOf(asset: Pick<MediaAsset, 'speaker' | 'credit'>): string {
  if (asset.speaker !== undefined && asset.speaker.trim() !== '') return asset.speaker.trim()
  return asset.credit?.source === 'link' ? (asset.credit.author ?? '').trim() : ''
}
