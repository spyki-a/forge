/**
 * Best clips, pressed through on the page (docs/CLIPS.md §7.7's cards half,
 * after M0's clipItCheck.ts). Since the clip maker's layout (piece 2) its
 * choices are in the URL tile and its cards in the fold-out panel's Clips
 * tab beside the picture: the check chooses the length in the tile's
 * "Duration" list, presses Analyse there, and reads and presses the cards in
 * the tab, which Analyse opens (each pressed case fails if it did not).
 *
 *   await window.__forgeBestClipsCheck()   → { ok, cases: [{ name, ok, saw }], ms }
 *
 * It never throws: a case that could not go on says so in its own `saw` and
 * fails. Run it in the FRONTED tab on a freshly loaded page (React's updates
 * are waited for with animation frames, which a background tab never runs).
 *
 * THE CARDS HALF. Every case of `BEST_CLIPS_STUB_CASES` (bestClipsStub.ts,
 * run A's rules 1 to 26 that a page can show): the case's made-up words put
 * in the URL tile as the link's transcript, its length PRESSED (unfolding the
 * length list and pressing the choice), Analyse PRESSED, and the cards read
 * off the screen — title, why,
 * range, word count, "Picked by …", note, and the notes under the cards. The
 * model is the harness's stub put in place of the bridge's
 * `directorStatus`/`directorComplete` (no model: the bridge's own status, as
 * the page has it), so what is under test is the app's own path: the store's
 * Analyse, `bestClipsAskOver`, `askStructured`, `bestClips`, the panel. Each
 * case also holds the screen to the store's result (`seenOf`), and the
 * throwing model's address and key to the WHOLE page's text and every notice.
 *
 * One case is not pressed: a model that never answers, against Analyse's own
 * three-minute deadline (BEST_CLIPS_TIMEOUT_MS). There `bestClips` is called
 * with a 300 ms timeout, its result written to the store as Analyse writes
 * it, the panel opened on Clips through the store, and the tab read (run A's note: the real deadline takes 3 minutes).
 *
 * THE CLIP IT HALF, on the bridge's twelve-row talk with no model, through
 * the bridge's recorded downloads (bridge.ts `harnessIngests`); a download
 * lands when the check collects it, through a `collectIngest` stood in for
 * main's that hands back an offline asset (the preview draws "Media offline"
 * and loads nothing):
 *   - the empty timeline: Clip it on a card → this project 9:16, one exact
 *     download of exactly the card's range, the card's lines;
 *   - landed without the AI helper: the crop centred, said; captions, off
 *     before, turned on; graphics run, its line counting what is there;
 *   - landed with the helper and the face finder (the bridge's reframe stub):
 *     followed, captions kept off the faces, graphics after; and §12.1's
 *     order watched both ways — graphics never running while a reframe
 *     analysis is pending, and no analysis appearing while graphics runs;
 *   - landed with the helper but no face finder on disk: the line names it
 *     and nothing fetches it (no progress, the stub's file still absent, no
 *     analysis asked); captions and graphics still run;
 *   - each landed case counts the undo steps PER STEP, read at the moment
 *     each line ends: the landing one, the follow one when it landed a
 *     track, captions exactly one (each landed case first turns the empty
 *     project's captions OFF, since a new project's are on already and step 4
 *     would otherwise change nothing to see), graphics none or one;
 *   - a timeline with a 16:9 edit: the question on the card, Not now, then
 *     "Add it to this project" (aspect and every existing crop unchanged);
 *   - unsaved work: "Start a new 9:16 project for this clip" saves first
 *     (the bridge's Save, answered), then a new 9:16 project and the
 *     download;
 *   - M0's Clip download from picked rows (captions off first): one undo step
 *     on landing and no step after it — no follow, captions still off, no
 *     graphics, no record.
 *
 * WHEN ALL IS WELL: `ok: true` and every case `ok: true` — 29 cards cases
 * and 7 Clip it cases, 36 in all (BEST_CLIPS_CHECK_CASES). The store, the
 * bridge's switches, the Shelf and the fold-out panel are put back afterwards; the bridge's
 * record of the downloads asked stays.
 */

import { bestClips } from '@shared/bestclips/run'
import { BEST_CLIPS_LENGTHS, bestClipsAskOver, initialBestClips } from '@shared/bestclips/session'
import { candidatesFor } from '@shared/bestclips/signals'
import {
  ADD_TO_PROJECT,
  cardGraphicsCount,
  cardKey,
  graphicsResultText,
  START_NEW_PROJECT,
  STEP_LABEL,
  STEP_TEXT,
  stepEnded,
  type CardStepName
} from '@shared/bestclips/cardClip'
import type { CompletionRequest } from '@shared/director/provider'
import type { IngestRequest } from '@shared/ingest/args'
import type { CollectedDownload } from '@shared/ingest/collect'
import type { LinkClip } from '@shared/ingest/linkClip'
import { runFromRows } from '@shared/ingest/wordRun'
import type { MediaAsset } from '@shared/timeline'
import { useEditor, type UrlSource } from '../store'
import { HARNESS_LINKS, harnessIngests, harnessReframe } from './bridge'
import {
  BEST_CLIPS_CHECK_CASES,
  BEST_CLIPS_STUB_CASES,
  caseFailures,
  CLIP_IT_CASE_NAMES,
  seenOf,
  stubComplete,
  STUB_READY,
  STUB_SECRET_KEY,
  STUB_SECRET_URL,
  type SeenCard,
  type SeenCards,
  type StubCalls,
  type StubCase
} from './bestClipsStub'

export interface BestClipsCheckCase {
  name: string
  ok: boolean
  saw: unknown
}

export interface BestClipsCheckReport {
  ok: boolean
  cases: BestClipsCheckCase[]
  ms: number
}

export { BEST_CLIPS_CHECK_CASES, CLIP_IT_CASE_NAMES }

const editor = (): ReturnType<typeof useEditor.getState> => useEditor.getState()
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function frames(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('requestAnimationFrame did not fire in 3 s — bring the harness tab to the front')), 3000)
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  } finally {
    clearTimeout(timer)
  }
}

async function until<T>(test: () => T | null | undefined | false, ms: number, what: string): Promise<T> {
  const stop = performance.now() + ms
  for (;;) {
    const value = test()
    if (value) return value
    if (performance.now() > stop) throw new Error(`${what} did not happen in ${ms / 1000} s`)
    await frames()
  }
}

function panel(): Element {
  const found = document.querySelectorAll('[data-shelf-tool="url"] [data-shelf-panel]')
  if (found.length !== 1) throw new Error(`expected the URL tile's panel, found ${found.length}`)
  return found[0]
}

const section = (): Element => {
  const s = panel().querySelector('[data-best-clips]')
  if (!s) throw new Error('no Best clips section in the URL tile')
  return s
}

/** The fold-out panel's Clips tab, where the cards are: open, or the check says so. */
const clipsTab = (): Element => {
  const found = document.querySelectorAll('[data-foldout-body="clips"] [data-best-clips-tab]')
  if (found.length !== 1) throw new Error(`expected the fold-out panel's Clips tab, found ${found.length} (the panel is ${editor().foldout.open ? `open on ${editor().foldout.tab}` : 'shut'})`)
  return found[0]
}

/** Choose a length as a person does: unfold "Duration", press the length. The list folds and its button says the choice, or the failure is said. */
async function pickLength(ms: number, failures: string[]): Promise<void> {
  const list = section().querySelector('[data-fold-down="best-length"]')
  if (!list) throw new Error('no length list in Best clips')
  if (list.getAttribute('data-open') !== 'true') {
    click(list.querySelector(':scope > button[aria-expanded]'), 'the length list')
    await frames()
  }
  click(section().querySelector(`button[data-best-length="${ms}"]`), `the ${ms / 60_000} min length`)
  await frames()
  const after = section().querySelector('[data-fold-down="best-length"]')
  const label = BEST_CLIPS_LENGTHS.find((l) => l.ms === ms)?.label ?? '?'
  if (after?.getAttribute('data-open') !== 'false') failures.push('the length list did not fold after a choice')
  if (!(after?.querySelector(':scope > button')?.textContent ?? '').includes(label)) failures.push(`the length list does not say ${label}`)
  if (editor().bestClips.targetMs !== ms) failures.push(`the length chosen is ${editor().bestClips.targetMs} ms, not ${ms}`)
}

function click(el: Element | null, what: string): void {
  if (!(el instanceof HTMLElement)) throw new Error(`no ${what} on screen`)
  if (el instanceof HTMLButtonElement && el.disabled) throw new Error(`${what} is greyed`)
  el.click()
}

const text = (el: Element | null): string | null => (el ? (el.textContent ?? '') : null)

/** The cards and notes as the screen shows them, in the Clips tab. */
function readCards(): SeenCards {
  const s = clipsTab()
  const cards: SeenCard[] = [...s.querySelectorAll('li[data-best-card]')].map((li) => ({
    windowId: li.getAttribute('data-best-card') ?? '',
    title: text(li.querySelector('[data-card-title]')) ?? '',
    why: text(li.querySelector('[data-card-why]')) ?? '',
    by: li.getAttribute('data-scored-by') === 'model' ? 'model' : 'signals',
    byLabel: text(li.querySelector('[data-card-by]')) ?? '',
    note: text(li.querySelector('[data-card-note]')),
    range: text(li.querySelector('[data-card-range]')) ?? '',
    words: text(li.querySelector('[data-card-words]')) ?? ''
  }))
  return { cards, note: text(s.querySelector('[data-best-note]')), modelNote: text(s.querySelector('[data-best-model-note]')) }
}

const short = (seen: SeenCards): unknown => ({
  cards: seen.cards.map((c) => `${c.windowId} ${c.by}${c.note ? ' (noted)' : ''}: ${[...c.title].slice(0, 24).join('')}`),
  note: seen.note,
  modelNote: seen.modelNote
})

/** The bridge, as the check stands parts of it in. */
type Forge = Record<string, unknown>
const forge = (): Forge => window.forge as unknown as Forge

/* -------------------------------------------------------------- the cards */

async function cardCase(k: StubCase, base: UrlSource, original: Forge): Promise<BestClipsCheckCase> {
  const link = k.link()
  const calls: StubCalls = { n: 0 }
  const failures: string[] = []
  let seen: SeenCards | null = null
  try {
    const source: UrlSource = {
      ...base,
      transcript: link.transcript,
      meta: base.meta ? { ...base.meta, heatmap: link.heatmap, language: link.language || null } : null,
      status: 'ready',
      run: null,
      anchorRow: null,
      clipped: false
    }
    useEditor.setState({ urlSource: source, bestClips: initialBestClips() })
    Object.assign(forge(), {
      directorStatus: k.model === null ? original.directorStatus : async () => STUB_READY,
      directorComplete: k.model === null ? original.directorComplete : (request: CompletionRequest) => stubComplete(k.model as never, link, calls)(request)
    })
    await frames()
    await pickLength(link.targetMs, failures)

    if (k.model === 'never') {
      // Analyse's own deadline is three minutes: bestClips is called with 300 ms, and its result written as Analyse writes it.
      const asked = { linkKey: source.linkKey, targetMs: link.targetMs, transcript: link.transcript }
      const result = await bestClips(link.transcript, source.meta, link.targetMs, bestClipsAskOver(stubComplete('never', link, calls)), { timeoutMs: 300 })
      useEditor.setState((s) => ({ bestClips: { ...s.bestClips, last: { ...asked, result } } }))
      // Not pressed, so the panel is opened as the Clips toggle opens it.
      editor().openFoldout('clips')
    } else {
      const press = async (): Promise<void> => {
        editor().closeFoldout()
        await frames()
        click(panel().querySelector('button[data-best-analyse]'), 'Analyse')
        if (!editor().foldout.open || editor().foldout.tab !== 'clips') failures.push('Analyse did not open the panel on Clips')
        await until(() => editor().bestClips.running === null && editor().bestClips.last !== null, 8000, 'Analyse answering')
        await frames()
      }
      await press()
      if (k.twice) {
        const first = readCards().cards.map((c) => c.windowId)
        useEditor.setState((s) => ({ bestClips: { ...s.bestClips, last: null } }))
        await frames()
        await press()
        const again = readCards().cards.map((c) => c.windowId)
        if (JSON.stringify(first) !== JSON.stringify(again)) failures.push(`the second Analyse showed ${again.join(',')}, the first ${first.join(',')}`)
      }
    }
    await frames()
    seen = readCards()
    const result = editor().bestClips.last?.result ?? null
    if (!result) failures.push('the store kept no result')
    else {
      // The screen is the store's result, card for card.
      if (JSON.stringify(seenOf(result)) !== JSON.stringify(seen)) failures.push('the cards on screen are not the store’s result')
      failures.push(...caseFailures(k, seen, candidatesFor(link.transcript, link.targetMs, link.heatmap), link.transcript))
    }
    if (k.model === null && calls.n !== 0) failures.push(`with no model the stub was asked ${calls.n} times`)
    if (k.model !== null && calls.n === 0) failures.push('the model stub was never asked')
    if (k.model === 'throws') {
      // The whole document as markup (every text node and every attribute: tooltips, aria labels, data-*, hidden parts, <head>),
      // and every notice: a key in a title= would not be in innerText.
      const page = `${document.documentElement.outerHTML}\n${editor().notices.map((n) => n.text).join('\n')}`
      for (const secret of [STUB_SECRET_URL, '10.0.0.7', STUB_SECRET_KEY, 'sk-harness']) {
        if (page.includes(secret)) failures.push(`"${secret}" is on the page`)
      }
    }
  } catch (err) {
    failures.push(`stopped: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { name: k.name, ok: failures.length === 0, saw: { ...(seen ? (short(seen) as object) : {}), stubAsked: calls.n, failures } }
}

/* ------------------------------------------------------------- Clip it */

/** A card's lines on screen, by step. */
function stepsOn(windowId: string): Partial<Record<CardStepName, { state: string; label: string; text: string }>> {
  const li = clipsTab().querySelector(`li[data-best-card="${windowId}"]`)
  const out: Partial<Record<CardStepName, { state: string; label: string; text: string }>> = {}
  for (const row of li?.querySelectorAll('li[data-card-step]') ?? []) {
    const spans = row.querySelectorAll('span')
    out[row.getAttribute('data-card-step') as CardStepName] = {
      state: row.getAttribute('data-step-state') ?? '',
      label: text(spans[0]) ?? '',
      text: text(spans[1]) ?? ''
    }
  }
  return out
}

/** One card's line: the label, the state and the words. */
function line(steps: ReturnType<typeof stepsOn>, name: CardStepName, state: string, words: string, failures: string[]): void {
  const got = steps[name]
  if (!got) return void failures.push(`no ${STEP_LABEL[name]} line on the card`)
  if (got.label !== STEP_LABEL[name]) failures.push(`the ${name} line is labelled "${got.label}"`)
  if (got.state !== state || got.text !== words) failures.push(`${STEP_LABEL[name]} reads ${got.state} "${got.text}", not ${state} "${words}"`)
}

/** Step 5's line as it must read: what the run left for the card's clip, counted off the project. */
function graphicsLine(jobId: string): string {
  const clip = editor().project.clips.find((c) => c.assetId === `harness-best-${jobId}`)
  if (!clip) return '(the clip is not on the timeline)'
  const { placed, waiting } = cardGraphicsCount(editor().project, clip.id)
  return graphicsResultText(placed, waiting)
}

const ended = (windowId: string): boolean => ['done', 'skipped', 'failed'].includes(stepsOn(windowId).graphics?.state ?? '')

function clipItButton(windowId: string): HTMLButtonElement | null {
  const foot = clipsTab().querySelector(`li[data-best-card="${windowId}"] [data-best-clip-it]`)
  return [...(foot?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Clip it') ?? null
}

/** A download handed back as main's collect would, for a recorded job: an offline 16:9 video as long as the range. */
function collectAs(original: Forge): (jobId: string, fps: number) => Promise<CollectedDownload> {
  return async (jobId, fps) => {
    const job = harnessIngests.find((j) => j.id === jobId)
    if (!job) return (original.collectIngest as (id: string, f: number) => Promise<CollectedDownload>)(jobId, fps)
    const range = job.request.range ?? { startMs: 0, endMs: 10_000 }
    const path = `harness://best-clips/${jobId}.mp4`
    const asset: MediaAsset = {
      id: `harness-best-${jobId}`,
      path,
      name: `harness best clip ${jobId}`,
      kind: 'video',
      durationFrames: Math.max(1, Math.round(((range.endMs - range.startMs) / 1000) * fps)),
      width: 1920,
      height: 1080,
      fps,
      hasVideo: true,
      hasAudio: true,
      size: 1,
      offline: true
    }
    return { path, asset, cached: false, approximateRange: false, requestedRange: range, stems: null, link: job.clip as LinkClip | null }
  }
}

/** A clip of an offline 16:9 video placed on the timeline, as somebody's edit. */
function placeEdit(): void {
  const fps = editor().project.settings.fps
  const asset: MediaAsset = {
    id: `harness-edit-${Date.now().toString(36)}`,
    path: 'harness://best-clips/edit.mp4',
    name: 'harness edit',
    kind: 'video',
    durationFrames: 10 * fps,
    width: 1920,
    height: 1080,
    fps,
    hasVideo: true,
    hasAudio: true,
    size: 1,
    offline: true
  }
  editor().update((p) => ({ ...p, assets: [...p.assets, asset] }))
  editor().addAssetToTimeline(asset.id)
}

const lastJob = (): { id: string; request: IngestRequest } | undefined => harnessIngests[harnessIngests.length - 1]

/** The steps in the order they run after the download. */
const AFTER: readonly CardStepName[] = ['reframe', 'captions', 'graphics']

/**
 * The undo stack's depth at the moment each of a card's steps ended, read on
 * every store change: so each step's own undo steps are counted, not a total
 * that a step writing two (or a step merged into another's) could hide in.
 */
function watchSteps(key: string): { at: Partial<Record<CardStepName, number>>; stop: () => void } {
  const at: Partial<Record<CardStepName, number>> = {}
  const read = (): void => {
    const s = editor()
    for (const step of s.bestClipsClipped[key]?.steps ?? []) {
      if (at[step.name] === undefined && stepEnded(step)) at[step.name] = s.past.length
    }
  }
  read()
  return { at, stop: useEditor.subscribe(read) }
}

/**
 * Each step's own undo steps: the landing exactly one; the follow one when it
 * landed a track and none when skipped; captions one exactly when the
 * project's captions changed; graphics none or one. A step never takes the
 * clip back (`clipLeft`).
 */
function undoSteps(
  at: Partial<Record<CardStepName, number>>,
  depth: number,
  want: { reframe: 0 | 1; captions: 0 | 1 },
  failures: string[]
): Record<string, number | null> {
  const order: CardStepName[] = ['download', ...AFTER]
  const out: Record<string, number | null> = {}
  let before = depth
  for (const name of order) {
    const end = at[name]
    if (end === undefined) {
      failures.push(`the ${name} step never ended`)
      out[name] = null
      continue
    }
    out[name] = end - before
    before = end
  }
  if (out.download !== 1) failures.push(`the landing made ${out.download} undo steps, not 1`)
  if (out.reframe !== want.reframe) failures.push(`the follow made ${out.reframe} undo steps, not ${want.reframe}`)
  if (out.captions !== want.captions) failures.push(`captions made ${out.captions} undo steps, not ${want.captions}`)
  if (out.graphics !== null && out.graphics !== 0 && out.graphics !== 1) failures.push(`graphics made ${out.graphics} undo steps`)
  return out
}

async function clipItCases(original: Forge, talk: () => Promise<void>): Promise<BestClipsCheckCase[]> {
  const out: BestClipsCheckCase[] = []
  const run = async (name: string, body: (failures: string[]) => Promise<unknown>): Promise<void> => {
    const failures: string[] = []
    let saw: unknown = null
    try {
      saw = await body(failures)
    } catch (err) {
      failures.push(`stopped: ${err instanceof Error ? err.message : String(err)}`)
    }
    out.push({ name, ok: failures.length === 0, saw: { ...(typeof saw === 'object' && saw ? saw : {}), failures } })
  }
  const fresh = (): void => {
    editor().newProject({ name: 'Untitled', aspect: '16:9', fps: 30 })
  }
  Object.assign(forge(), { directorStatus: original.directorStatus, directorComplete: original.directorComplete, collectIngest: collectAs(original) })

  // The cards of the talk, no model: three, as the census's link-best-clips.
  fresh()
  await talk()
  const picked: string[] = []
  await pickLength(60_000, picked)
  if (picked.length > 0) throw new Error(picked.join('; '))
  click(panel().querySelector('button[data-best-analyse]'), 'Analyse')
  await until(() => editor().bestClips.running === null && (editor().bestClips.last?.result.cards.length ?? 0) === 3, 5000, 'three cards on the talk')
  await frames()
  const cards = editor().bestClips.last!.result.cards

  /* 1. the empty timeline */
  let firstJob = ''
  await run(CLIP_IT_CASE_NAMES[0], async (failures) => {
    fresh()
    editor().setReframeHelper('missing')
    await frames()
    const before = harnessIngests.length
    click(clipItButton(cards[0].windowId), 'card 1’s Clip it')
    await until(() => harnessIngests.length > before, 3000, 'the card’s download being asked')
    await frames()
    const job = lastJob()!
    firstJob = job.id
    const settings = editor().project.settings
    if (harnessIngests.length !== before + 1) failures.push(`${harnessIngests.length - before} downloads asked, not 1`)
    if (editor().bestClipsQuestion !== null || clipsTab().querySelector('[data-best-question]')) failures.push('the empty timeline was asked about')
    if (editor().aspect !== '9:16' || settings.height <= settings.width) failures.push(`the project is ${editor().aspect} ${settings.width}×${settings.height}, not 9:16`)
    if (job.request.exact !== true) failures.push('the download is not an exact cut')
    if (job.request.range?.startMs !== cards[0].startMs || job.request.range?.endMs !== cards[0].endMs) {
      failures.push(`the download asks ${JSON.stringify(job.request.range)}, not the card's ${cards[0].startMs}–${cards[0].endMs}`)
    }
    const steps = stepsOn(cards[0].windowId)
    line(steps, 'download', 'running', STEP_TEXT.downloading, failures)
    line(steps, 'shape', 'done', STEP_TEXT.shapeSet, failures)
    return { aspect: editor().aspect, range: job.request.range, steps }
  })

  /* 2. landed without the AI helper */
  await run(CLIP_IT_CASE_NAMES[1], async (failures) => {
    if (!firstJob) throw new Error('the first card was never sent')
    const jobsBefore = harnessReframe.jobs.length
    // A new project's captions are on already: off first, so step 4 has something to do and its undo step can be seen.
    editor().setCaptionsEnabled(false)
    await frames()
    const depth = editor().past.length
    const watch = watchSteps(cardKey(editor().urlSource!.linkKey, cards[0]))
    try {
      await editor().collectIngest(firstJob)
      await until(() => ended(cards[0].windowId), 8000, 'the graphics line ending')
    } finally {
      watch.stop()
    }
    await frames()
    const steps = stepsOn(cards[0].windowId)
    line(steps, 'download', 'done', STEP_TEXT.landed, failures)
    line(steps, 'reframe', 'skipped', STEP_TEXT.reframeNoHelper, failures)
    line(steps, 'captions', 'done', STEP_TEXT.captionsOn, failures)
    line(steps, 'graphics', 'done', graphicsLine(firstJob), failures)
    if (!editor().project.captions.enabled) failures.push('captions are not on')
    if (harnessReframe.jobs.length !== jobsBefore) failures.push('a reframe analysis was asked without the AI helper')
    const clip = editor().project.clips.find((c) => c.assetId === `harness-best-${firstJob}`)
    if (!clip) failures.push('the clip is not on the timeline at the end')
    else if (clip.follow) failures.push('the clip follows a subject without the AI helper')
    const undo = undoSteps(watch.at, depth, { reframe: 0, captions: 1 }, failures)
    return { steps, undo }
  })

  /* 3. landed with the AI helper and the face finder */
  await run(CLIP_IT_CASE_NAMES[2], async (failures) => {
    fresh()
    editor().setReframeHelper('ready')
    editor().setReframeModel(null)
    harnessReframe.modelPresent = true
    await frames()
    const before = harnessIngests.length
    click(clipItButton(cards[1].windowId), 'card 2’s Clip it')
    await until(() => harnessIngests.length > before, 3000, 'the card’s download being asked')
    const job = lastJob()!
    const jobsBefore = harnessReframe.jobs.length
    // §12.1, both ways: graphics turning on while an analysis is pending, and an analysis appearing while graphics runs.
    const graphicsOverReframe: string[] = []
    const reframeOverGraphics: string[] = []
    const stop = useEditor.subscribe((s, prev) => {
      const pending = Object.keys(s.reframe.pending).length
      if (s.findingGraphics !== null && prev.findingGraphics === null && pending > 0) graphicsOverReframe.push(`graphics started with ${pending} analyses pending`)
      if (pending > Object.keys(prev.reframe.pending).length && s.findingGraphics !== null) reframeOverGraphics.push('an analysis started while graphics ran')
    })
    editor().setCaptionsEnabled(false)
    await frames()
    const depth = editor().past.length
    const watch = watchSteps(cardKey(editor().urlSource!.linkKey, cards[1]))
    try {
      await editor().collectIngest(job.id)
      await until(() => ended(cards[1].windowId), 10_000, 'the graphics line ending')
    } finally {
      stop()
      watch.stop()
    }
    await frames()
    const steps = stepsOn(cards[1].windowId)
    line(steps, 'download', 'done', STEP_TEXT.landed, failures)
    line(steps, 'reframe', 'done', STEP_TEXT.reframeDone, failures)
    line(steps, 'captions', 'done', STEP_TEXT.captionsSmart, failures)
    line(steps, 'graphics', 'done', graphicsLine(job.id), failures)
    const clip = editor().project.clips.find((c) => c.assetId === `harness-best-${job.id}`)
    if (!clip?.follow) failures.push('the clip does not follow the subject')
    if (harnessReframe.jobs.length !== jobsBefore + 1) failures.push(`${harnessReframe.jobs.length - jobsBefore} analyses asked, not 1`)
    if (editor().project.captions.placement !== 'smart') failures.push(`captions placement is ${editor().project.captions.placement}`)
    if (Object.keys(editor().reframe.pending).length !== 0) failures.push('an analysis is still pending at the end')
    failures.push(...graphicsOverReframe, ...reframeOverGraphics)
    // Off before: step 4 turns them on kept off the faces, one undo step.
    if (!editor().project.captions.enabled) failures.push('captions are not on')
    const undo = undoSteps(watch.at, depth, { reframe: 1, captions: 1 }, failures)
    return { steps, graphicsOverReframe, reframeOverGraphics, undo }
  })

  /* 3b. the helper there, the face finder not on disk */
  await run(CLIP_IT_CASE_NAMES[3], async (failures) => {
    fresh()
    editor().setReframeHelper('ready')
    editor().setReframeModel(null)
    harnessReframe.modelPresent = false
    await frames()
    const before = harnessIngests.length
    // Card 1's clip landed in case 2's project, not this one: it can be clipped again here.
    click(clipItButton(cards[0].windowId), 'card 1’s Clip it')
    await until(() => harnessIngests.length > before, 3000, 'the card’s download being asked')
    const job = lastJob()!
    const jobsBefore = harnessReframe.jobs.length
    // Nothing may fetch the face finder: no progress shown, no download asked of the stub.
    let fetching = false
    const stop = useEditor.subscribe((s) => {
      if (s.reframe.fetching !== null) fetching = true
    })
    editor().setCaptionsEnabled(false)
    await frames()
    const depth = editor().past.length
    const watch = watchSteps(cardKey(editor().urlSource!.linkKey, cards[0]))
    try {
      await editor().collectIngest(job.id)
      await until(() => ended(cards[0].windowId), 8000, 'the graphics line ending')
    } finally {
      stop()
      watch.stop()
    }
    await frames()
    const steps = stepsOn(cards[0].windowId)
    line(steps, 'download', 'done', STEP_TEXT.landed, failures)
    line(steps, 'reframe', 'skipped', STEP_TEXT.reframeNoModel, failures)
    line(steps, 'captions', 'done', STEP_TEXT.captionsOn, failures)
    line(steps, 'graphics', 'done', graphicsLine(job.id), failures)
    if (!editor().project.captions.enabled) failures.push('captions are not on')
    if (harnessReframe.modelPresent) failures.push('the face finder was fetched')
    if (fetching) failures.push('a fetch of the face finder was shown')
    if (harnessReframe.jobs.length !== jobsBefore) failures.push('an analysis was asked without the face finder')
    const undo = undoSteps(watch.at, depth, { reframe: 0, captions: 1 }, failures)
    return { steps, undo }
  })

  /* 4. a 16:9 edit: the question, Not now, Add */
  await run(CLIP_IT_CASE_NAMES[4], async (failures) => {
    fresh()
    placeEdit()
    editor().setReframeHelper('missing')
    await frames()
    const crops = editor().project.clips.map((c) => JSON.stringify(c.crop ?? null))
    const settings = { ...editor().project.settings }
    const before = harnessIngests.length
    click(clipItButton(cards[2].windowId), 'card 3’s Clip it')
    await frames()
    const question = clipsTab().querySelector(`li[data-best-card="${cards[2].windowId}"] [data-best-question]`)
    if (!question) throw new Error('no question on the card')
    const labels = [...question.querySelectorAll('button')].map((b) => (b.querySelector('span')?.textContent ?? b.textContent ?? '').trim())
    if (!labels.includes(START_NEW_PROJECT) || !labels.includes(ADD_TO_PROJECT)) failures.push(`the question's answers read ${JSON.stringify(labels)}`)
    if (harnessIngests.length !== before) failures.push('asking sent a download')
    click(question.querySelector('button[data-best-choice="cancel"]'), 'Not now')
    await frames()
    if (editor().bestClipsQuestion !== null || harnessIngests.length !== before) failures.push('Not now did not close the question, or sent something')
    click(clipItButton(cards[2].windowId), 'card 3’s Clip it, again')
    await frames()
    click(clipsTab().querySelector(`li[data-best-card="${cards[2].windowId}"] button[data-best-choice="add"]`), 'Add it to this project')
    await until(() => harnessIngests.length > before, 3000, 'Add sending the download')
    await frames()
    const after = editor().project
    if (editor().aspect !== '16:9' || after.settings.width !== settings.width || after.settings.height !== settings.height) failures.push(`the aspect changed to ${editor().aspect}`)
    const cropsAfter = after.clips.map((c) => JSON.stringify(c.crop ?? null))
    if (JSON.stringify(crops) !== JSON.stringify(cropsAfter.slice(0, crops.length))) failures.push('an existing clip’s crop changed')
    line(stepsOn(cards[2].windowId), 'shape', 'done', STEP_TEXT.shapeKept, failures)
    return { labels, aspect: editor().aspect, downloads: harnessIngests.length - before }
  })

  /* 5. unsaved work: Start new saves first */
  await run(CLIP_IT_CASE_NAMES[5], async (failures) => {
    fresh()
    placeEdit()
    useEditor.setState({ dirty: true, projectPath: null })
    const saves: { clips: number }[] = []
    Object.assign(forge(), {
      saveProject: async (project: { clips: unknown[] }) => {
        saves.push({ clips: project.clips.length })
        return '/harness/best-clips-saved.forge'
      }
    })
    const oldId = editor().project.id
    await frames()
    const before = harnessIngests.length
    // Card 1's clip went into another project (case 1): it can be clipped again here.
    click(clipItButton(cards[0].windowId), 'card 1’s Clip it')
    await frames()
    click(clipsTab().querySelector(`li[data-best-card="${cards[0].windowId}"] button[data-best-choice="new"]`), 'Start a new 9:16 project for this clip')
    await until(() => harnessIngests.length > before, 3000, 'Start new sending the download')
    await frames()
    if (saves.length !== 1 || saves[0].clips !== 1) failures.push(`${saves.length} saves (${JSON.stringify(saves)}), not one of the edit`)
    if (editor().project.id === oldId) failures.push('no new project was started')
    const s = editor().project.settings
    if (editor().aspect !== '9:16' || s.height <= s.width) failures.push(`the new project is ${editor().aspect}`)
    if (editor().project.clips.length !== 0) failures.push(`the new project has ${editor().project.clips.length} clips before the download lands`)
    if (lastJob()?.request.range?.startMs !== cards[0].startMs) failures.push('the download is not card 1’s')
    line(stepsOn(cards[0].windowId), 'shape', 'done', STEP_TEXT.shapeNew, failures)
    return { saves, aspect: editor().aspect }
  })

  /* 6. M0's rows route */
  await run(CLIP_IT_CASE_NAMES[6], async (failures) => {
    fresh()
    placeEdit()
    editor().setReframeHelper('ready')
    harnessReframe.modelPresent = true
    const records = Object.keys(editor().bestClipsClipped).length
    const graphicsBefore = editor().lastGraphics
    // Off first: a captions step chained by mistake onto M0's route would turn them on.
    editor().setCaptionsEnabled(false)
    const captions = JSON.stringify(editor().project.captions)
    const t = editor().urlSource?.transcript
    if (!t) throw new Error('the talk has no transcript')
    editor().setUrlRun(runFromRows(t, 2, 5))
    await frames()
    const before = harnessIngests.length
    const jobsBefore = harnessReframe.jobs.length
    // Clip download is in the fold-out's Transcript tab, under the link's words (piece 3), not in the URL tile.
    editor().openFoldout('transcript', 'link')
    const words = await until(
      () => document.querySelector('[data-foldout-body="transcript"] [data-transcript-rows]')?.closest('[data-foldout-body="transcript"]') ?? null,
      3000,
      'the link’s words in the Transcript tab'
    )
    click([...words.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Clip download') ?? null, 'Clip download')
    await until(() => harnessIngests.length > before, 3000, 'Clip download asking')
    let graphicsRan = false
    const stop = useEditor.subscribe((s) => {
      if (s.findingGraphics !== null) graphicsRan = true
    })
    const depth = editor().past.length
    try {
      await editor().collectIngest(lastJob()!.id)
      await sleep(400)
    } finally {
      stop()
    }
    if (editor().past.length - depth !== 1) failures.push(`${editor().past.length - depth} undo steps on landing, not 1`)
    if (harnessReframe.jobs.length !== jobsBefore) failures.push('a reframe analysis was asked')
    if (graphicsRan || editor().lastGraphics !== graphicsBefore) failures.push('graphics ran')
    if (JSON.stringify(editor().project.captions) !== captions || editor().project.captions.enabled) failures.push('the captions changed')
    if (Object.keys(editor().bestClipsClipped).length !== records) failures.push('a card record was written')
    if (editor().aspect !== '16:9') failures.push(`the aspect is ${editor().aspect}`)
    return { undoSteps: editor().past.length - depth }
  })
  return out
}

/* ------------------------------------------------------------------ run */

export async function runBestClipsCheck(): Promise<BestClipsCheckReport> {
  const started = performance.now()
  const cases: BestClipsCheckCase[] = []
  const s = editor()
  const kept = {
    urlSource: s.urlSource,
    ingest: s.ingest,
    pendingIngests: s.pendingIngests,
    bestClips: s.bestClips,
    bestClipsVertical: s.bestClipsVertical,
    bestClipsQuestion: s.bestClipsQuestion,
    bestClipsClipped: s.bestClipsClipped,
    project: s.project,
    past: s.past,
    future: s.future,
    dirty: s.dirty,
    projectPath: s.projectPath,
    aspect: s.aspect,
    playhead: s.playhead,
    selectedClipIds: s.selectedClipIds,
    selectedClipId: s.selectedClipId,
    lastGraphics: s.lastGraphics,
    shelfTool: s.shelfTool,
    foldout: s.foldout,
    foldDownOpen: s.foldDownOpen,
    reframeHelper: s.reframe.helper,
    reframeModel: s.reframe.model,
    modelPresent: harnessReframe.modelPresent
  }
  const original: Forge = { ...forge() }
  const restoreForge = (): void => {
    Object.assign(forge(), {
      directorStatus: original.directorStatus,
      directorComplete: original.directorComplete,
      collectIngest: original.collectIngest,
      saveProject: original.saveProject
    })
  }

  try {
    editor().setShelfTool('url')
    // The cards are in the fold-out panel: a page too narrow to open it beside the picture would fail every
    // pressed case alike, so it is said once, with the width, and the check stops.
    editor().openFoldout('clips')
    await frames()
    await frames()
    if (!editor().foldout.open) {
      throw new Error(
        `the page is too narrow to open the panel beside the picture (the picture row is ${Math.round(document.querySelector('[data-foldout]')?.closest('[data-group]')?.getBoundingClientRect().width ?? 0)} px; the panel needs 280 px beside 35 % of the picture): widen the window and run it again`
      )
    }
    editor().closeFoldout()
    editor().setIngest({ url: HARNESS_LINKS.talk, useRange: false, busy: false })
    useEditor.setState({ urlSource: null, bestClips: initialBestClips(), bestClipsVertical: true, bestClipsQuestion: null, bestClipsClipped: {} })
    const talk = async (): Promise<void> => {
      useEditor.setState({ urlSource: null, bestClips: initialBestClips() })
      await editor().getTranscript()
      await until(() => editor().urlSource?.status === 'ready', 3000, 'Get transcript on the talk')
      await frames()
    }
    await talk()
    const base = editor().urlSource!
    for (const k of BEST_CLIPS_STUB_CASES) cases.push(await cardCase(k, base, original))
    restoreForge()
    cases.push(...(await clipItCases(original, talk)))
  } catch (err) {
    cases.push({ name: 'the check itself', ok: false, saw: { failures: [`stopped: ${err instanceof Error ? err.message : String(err)}`] } })
  } finally {
    restoreForge()
    harnessReframe.modelPresent = kept.modelPresent
    useEditor.setState({
      urlSource: kept.urlSource,
      ingest: kept.ingest,
      pendingIngests: kept.pendingIngests,
      bestClips: kept.bestClips,
      bestClipsVertical: kept.bestClipsVertical,
      bestClipsQuestion: kept.bestClipsQuestion,
      bestClipsClipped: kept.bestClipsClipped,
      project: kept.project,
      past: kept.past,
      future: kept.future,
      dirty: kept.dirty,
      projectPath: kept.projectPath,
      aspect: kept.aspect,
      playhead: kept.playhead,
      selectedClipIds: kept.selectedClipIds,
      selectedClipId: kept.selectedClipId,
      lastGraphics: kept.lastGraphics,
      foldout: kept.foldout,
      foldDownOpen: kept.foldDownOpen
    })
    editor().setReframeHelper(kept.reframeHelper)
    editor().setReframeModel(kept.reframeModel)
    editor().setShelfTool(kept.shelfTool)
    await sleep(0)
  }
  const expected = BEST_CLIPS_CHECK_CASES
  if (cases.length !== expected) cases.push({ name: `the number of cases: ${expected}`, ok: false, saw: { ran: cases.length } })
  return { ok: cases.every((c) => c.ok), cases, ms: Math.round(performance.now() - started) }
}

export function installBestClipsCheck(): void {
  ;(window as unknown as { __forgeBestClipsCheck: typeof runBestClipsCheck }).__forgeBestClipsCheck = runBestClipsCheck
}
