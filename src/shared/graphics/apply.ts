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
import { GRAPHIC_SOUND_LANE_NAME, footageOf, graphicSounds } from './sound'
import { GRAPHIC_TEMPLATES, type GraphicData, type GraphicSpec, type KeptGraphic } from './template'
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
 * `project.settings.fps`, as it does to the spine's apply).
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
  const name = asset?.speaker
  if (name === undefined || name.trim() === '') return null
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
 *    `ctx.fps`; a graphic it refuses is dropped with its note.
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
  const fps = ctx.fps
  const canvas = { width: project.settings.width, height: project.settings.height }
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
    const data = k.candidate.data
    const clip = project.clips.find((c) => c.id === k.clipId)
    if (!clip) {
      drop(path, data, NO_CLIP_NOTE)
      continue
    }
    const def = GRAPHIC_TEMPLATES[data.template]
    if (!def) {
      drop(path, data, NOT_DRAWN_NOTE)
      continue
    }
    const transcript = project.transcripts[k.assetId]
    if (!transcript) {
      drop(path, data, NO_TRANSCRIPT_NOTE)
      continue
    }
    // ctx.fps throughout, the project's rate under it.
    const beats = graphicBeats({ settings: { ...project.settings, fps } }, clip, transcript, k.candidate.beatWords, {
      spread: data.template !== 'quote'
    })
    if (beats === null) {
      // Once per clip (§6.8): every graphic on a retimed clip goes, with one note.
      if (!retimed.has(clip.id)) problems.push({ path, message: `graphics dropped: ${RETIMED_NOTE}` })
      retimed.add(clip.id)
      continue
    }
    const timing = graphicTiming(clip, beats, def, drawnText(data), fps)
    if (!timing.ok) {
      drop(path, data, timing.note)
      continue
    }
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
    timed.push({ path, kept: k, clipId: clip.id, rule, start: timing.start, duration: timing.duration, seconds: timing.seconds, spec })
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
  let next: Project = project
  const clipIds: string[] = []
  for (const t of budget.kept) {
    const template = t.spec.data.template
    const place = placeGraphic(next, t.clipId, t.start, t.duration, template, canvas)
    if (!place) {
      drop(t.path, t.spec.data, next.clips.some((c) => c.id === t.clipId) ? NO_FREE_THIRD_NOTE : NO_CLIP_NOTE)
      continue
    }
    const subject = subjectAtOnset(next, t.clipId, t.start, t.duration, template, canvas)
    if ('dropped' in subject) {
      drop(t.path, t.spec.data, subject.dropped)
      continue
    }
    const lane = graphicLane(next, t.clipId, t.start, t.duration, rule)
    if ('dropped' in lane) {
      drop(t.path, t.spec.data, lane.dropped)
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

  // 8. The sounds, on each landed graphic; graphicSounds re-places every graphic sound on its footage clip.
  const notes: string[] = []
  const mayGo = new Set<string>()
  for (const id of clipIds) {
    const g = next.clips.find((c) => c.id === id)!
    const out = graphicSounds(next, g, g.graphic!, rule, ctx.sounds ?? [], { newId })
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
    // A brought file no clip stands on any more (a sound the cap re-placed elsewhere) leaves the pool, as Clear's sweep would.
    const used = new Set(next.clips.map((c) => c.assetId))
    next = { ...next, assets: next.assets.filter((a) => !(mayGo.has(a.id) && a.broughtBy !== undefined && !used.has(a.id))) }
  }
  for (const n of notes) problems.push({ path: '$.sounds', message: n })

  if (proposals.length > 0) next = { ...next, graphicProposals: [...(next.graphicProposals ?? []), ...proposals] }
  return { project: next, problems, clipIds }
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
  const graphicIds = new Set(project.clips.filter((c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE && c.graphic).map((c) => c.id))
  const removed = project.clips.filter(
    (c) => c.generatedBy?.rule === CLIPS_GRAPHIC_RULE || (c.forGraphic !== undefined && graphicIds.has(c.forGraphic))
  )
  const proposals = project.graphicProposals?.filter((g) => g.rule !== CLIPS_GRAPHIC_RULE)
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
