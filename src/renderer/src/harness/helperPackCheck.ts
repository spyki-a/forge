/**
 * The AI helper's one Install, pressed through and read off the running page
 * (docs/CLIPS.md §3a.7 "Harness check", §3a.4).
 *
 *   await window.__forgeHelperPackCheck()   → the report, or throws with every failure
 *
 * Against the bridge's stub (bridge.ts `harnessHelper`), whose job walks the
 * real job's stages over the manifest's own files on a timer and fetches
 * nothing. Every press is a click on the control under examination; every
 * assertion is the text on screen, against what the stub's status and the
 * manifest say it should read (sizes through `formatBytes`, never written
 * here):
 *
 *   1. The stub reports `absent`: the store has the status and Follow the
 *      subject's grey is `missing`.
 *   2. A talk on a 9:16 canvas, selected: the Trimmer dock's Follow the subject
 *      is greyed, with one "needs the AI helper" pointer titled "install it in
 *      Settings". Its press opens Settings with the AI helper row in view, and
 *      the row reads "Not installed", grey, with "Install the AI helper · <the
 *      offer's bytes>" and the hosts sentence under it.
 *   3. Install pressed (the stub slowed): EXPORT lists "Installing the AI
 *      helper" with a stage in its speed column, and the row reads
 *      "Installing · <that stage>" with its presses waiting on the job.
 *   4. The job's X, mid-download: the row's Install reads "· N MB left", N the
 *      files not yet verified, and the job row says cancelled.
 *   5. Install again: the download starts from what was left; the speed
 *      column shows every stage, in order, as one ordered shape; the row
 *      reads "Running · Python <the manifest's> · pack <n> · <on disk>",
 *      green, with "Repair · <bytes>" and Remove; the gear's dot is green; and
 *      Follow the subject is enabled, with no pointer.
 *   6. The Media pool's Transcribe is greyed "needs the speech model", with
 *      the sized press "Get the speech model · <its bytes>" over the pool; the
 *      press fetches it and Transcribe is enabled.
 *   7. A pack whose beats group failed its self-test (no Visual C++ runtime):
 *      "Running · <n−1> of <n> helper features · beats needs Microsoft's
 *      Visual C++ runtime", grey, with Check again, Repair and Remove, and the
 *      whole sentence under them with Microsoft's link; Check again turns it
 *      green.
 *   8. Remove asks first, with both sizes: the pack's in its question, the
 *      downloaded models' beside its box (the speech model, fetched in 6),
 *      the box off; "Remove it" sends `{models: false}` and the row is back
 *      to Not installed, the whole size on its Install.
 *   9. The damaged, update, Group Policy and unsupported states, each as the
 *      table in §3a.4 has it.
 *
 * Run it in the FRONTED tab: React's updates are waited for with animation
 * frames, which a background tab never runs. The store, the stub and the
 * Shelf are put back afterwards.
 */

import { formatBytes } from '@shared/assets/pack'
import { HELPER_PACK } from '@shared/sidecar/packManifest'
import { HELPER_PYTHON_MISSING } from '@shared/sidecar/helperPython'
import { HELPER_BLOCKED_BY_POLICY } from '@shared/sidecar/status'
import { SELFTEST_GROUP_NAMES } from '@shared/sidecar/selftest'
import {
  CHECKING_SPACE,
  CHECKING_STARTING,
  CHECKING_THE_HELPER,
  UNPACKING_PYTHON,
  checkingGroupText,
  downloadingText,
  helperJobLabel
} from '@shared/sidecar/install'
import { hostsSentence } from '@shared/sidecar/row'
import { packBytes } from '@shared/sidecar/pack'
import { NEEDS_SPEECH_MODEL, speechModelLabel } from '@shared/asr/speechModel'
import type { MediaAsset } from '@shared/timeline'
import { useEditor } from '../store'
import { POINTER_TITLE, NEEDS_THE_HELPER, THIS_PACK } from '../components/SettingsPanel'
import {
  HARNESS_BEATS_FAILED,
  HARNESS_HELPER_PACK,
  HARNESS_SPEECH_MODEL_BYTES,
  harnessHelper,
  type HarnessHelperState
} from './bridge'

/** What the AI helper row showed: the dot, the words, the presses, the sentences under them. */
export interface RowSeen {
  dot: 'green' | 'red' | 'grey' | '?'
  text: string
  buttons: { kind: string; label: string; disabled: boolean; title: string }[]
  detail: string[]
  /** Each link under the presses. */
  links: string[]
}

export interface HelperPackReport {
  /** One entry per step: what it saw. A step a failure stopped short of is not here. */
  steps: { step: string; saw: Record<string, unknown> }[]
  /** Every text the EXPORT row's speed column showed during the second install, in order. */
  stages: string[]
  failures: string[]
  ms: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const editor = (): ReturnType<typeof useEditor.getState> => useEditor.getState()
const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

async function frames(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('helper check: requestAnimationFrame did not fire in 3 s — bring the harness tab to the front')),
        3000
      )
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Wait for `test` to hold, a frame at a time, up to `ms`. */
async function until<T>(test: () => T | null | undefined | false, ms: number, what: string): Promise<T> {
  const stop = performance.now() + ms
  for (;;) {
    const value = test()
    if (value) return value
    if (performance.now() > stop) throw new Error(`helper check: ${what} did not happen in ${ms / 1000} s`)
    await frames()
  }
}

/* --------------------------------------------------------------- the DOM */

function one<T extends Element>(selector: string, what: string, root: ParentNode = document): T {
  const found = root.querySelectorAll<T>(selector)
  if (found.length !== 1) throw new Error(`helper check: expected one ${what}, found ${found.length}`)
  return found[0]
}

/** The AI helper row in Settings, or null while Settings is shut. */
const section = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-helper-row]')

const DOTS: [string, RowSeen['dot']][] = [
  ['bg-emerald-500', 'green'],
  ['bg-red-500', 'red'],
  ['bg-ink-600', 'grey']
]
const dotOf = (el: Element | null): RowSeen['dot'] => DOTS.find(([cls]) => el?.classList.contains(cls))?.[1] ?? '?'

function rowSeen(): RowSeen {
  const box = section()
  if (!box) throw new Error('helper check: the AI helper row is not on screen')
  // <section><h3/><div>dot · word · line</div>[presses][sentences]…</section>
  const head = box.children[1]
  return {
    dot: dotOf(head?.querySelector('.rounded-full') ?? null),
    text: norm(head?.textContent),
    buttons: [...box.querySelectorAll<HTMLButtonElement>('button[data-helper-action]')].map((b) => ({
      kind: b.dataset.helperAction ?? '',
      label: norm(b.textContent),
      disabled: b.disabled,
      title: b.title
    })),
    detail: [...box.querySelectorAll(':scope > p')].map((p) => norm(p.textContent)),
    links: [...box.querySelectorAll<HTMLAnchorElement>(':scope > p a')].map((a) => a.href)
  }
}

const labels = (row: RowSeen): string[] => row.buttons.map((b) => b.label)

function action(kind: string): HTMLButtonElement {
  return one<HTMLButtonElement>(`[data-helper-row] button[data-helper-action="${kind}"]`, `${kind} press in the AI helper row`)
}

/** The header gear's dot: the same reading as the row's (row.ts `helperRow`). */
const gearDot = (): RowSeen['dot'] => dotOf(one('button[data-settings-gear][title="Settings"]', 'Settings gear').querySelector('.rounded-full'))

/** The Settings card's scroll box and where the row sits in it, px: in view when its top is inside both it and the window. */
function rowPlace(): { rowTop: number; boxTop: number; boxBottom: number; scrollTop: number; viewport: number; inView: boolean } {
  const box = section()
  if (!box) throw new Error('helper check: the AI helper row is not on screen')
  let scroller: Element | null = box.parentElement
  while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  const r = box.getBoundingClientRect()
  const s = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight }
  const round = (n: number): number => Math.round(n * 10) / 10
  return {
    rowTop: round(r.top),
    boxTop: round(s.top),
    boxBottom: round(s.bottom),
    scrollTop: Math.round(scroller?.scrollTop ?? 0),
    viewport: innerHeight,
    inView: r.top >= s.top - 0.5 && r.top < s.bottom && r.top < innerHeight && r.height > 0
  }
}

/** The Trimmer dock's Follow section. */
const reframePanel = (): Element => one('[data-reframe-panel]', 'Follow the subject section in the Trimmer dock')

function followButton(): HTMLButtonElement {
  const found = [...reframePanel().querySelectorAll<HTMLButtonElement>('button')].filter((b) => norm(b.textContent).startsWith('Follow the subject'))
  if (found.length !== 1) throw new Error(`helper check: expected one Follow the subject button, found ${found.length}`)
  return found[0]
}

/** EXPORT's row for the AI helper's job, by its name on screen. */
function jobRow(kindLabel: string): { row: Element; status: string; speed: string; cancel: HTMLButtonElement | null } | null {
  const strip = one('[data-strip="export"]', 'EXPORT strip')
  const names = [...strip.querySelectorAll('span')].filter((s) => norm(s.textContent) === kindLabel)
  if (names.length === 0) return null
  if (names.length > 1) throw new Error(`helper check: ${names.length} "${kindLabel}" rows in EXPORT`)
  const row = names[0].parentElement?.parentElement
  if (!row) throw new Error('helper check: the job row has no body')
  const status = row.querySelector('span.capitalize')
  // The speed column: its first text node is the stage; a running job's " · 3s left" is a node of its own.
  const speedSpan = status?.nextElementSibling ?? null
  return {
    row,
    status: norm(status?.textContent),
    speed: norm(speedSpan?.firstChild?.textContent ?? ''),
    cancel: row.querySelector<HTMLButtonElement>('button[title="Cancel"]')
  }
}

/** The Upload tile's pool: every Transcribe button (a tile's caption icon) by its title. */
function transcribeButtons(): HTMLButtonElement[] {
  const panel = one('[data-shelf-tool="upload"] [data-shelf-panel]', 'Upload tile')
  return [...panel.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.querySelector('svg') && /transcri|AI helper|speech model/i.test(b.title))
}

const escapeKey = (): boolean =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))

/* --------------------------------------------------------------- the run */

/** The words the stub's state should give, through the row's own sizes. */
const offerBytes = (): number => {
  const status = harnessHelper.status
  if ((status.state === 'absent' || status.state === 'damaged') && status.offer.supported) return status.offer.bytes
  throw new Error(`helper check: the stub's status (${status.state}) carries no offer`)
}

export async function runHelperPackCheck(): Promise<HelperPackReport> {
  const started = performance.now()
  const failures: string[] = []
  const expect = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what)
  }
  const report: HelperPackReport = { steps: [], stages: [], failures, ms: 0 }
  const saw = (step: string, seen: Record<string, unknown>): void => {
    report.steps.push({ step, saw: seen })
  }
  if (document.visibilityState !== 'visible') {
    throw new Error('helper check: the harness tab is hidden — bring it to the front (React is waited for with animation frames)')
  }

  const kept = { ...editor() }
  let observer: MutationObserver | null = null

  const setState = async (state: HarnessHelperState, word: string): Promise<RowSeen> => {
    harnessHelper.set(state)
    return until(() => {
      const row = section() ? rowSeen() : null
      return row && row.text.startsWith(word) ? row : null
    }, 3000, `the row reading "${word}" for the stub's ${state}`)
  }

  try {
    harnessHelper.reset()
    editor().setSettingsOpen(false)
    editor().setExportOpen(true)
    await frames()

    /* 1. the stub reports absent */
    harnessHelper.set('absent')
    await until(() => editor().helperStatus?.state === 'absent' && editor().reframe.helper === 'missing', 3000, 'the store taking the absent status')
    const offer = harnessHelper.status.state === 'absent' ? harnessHelper.status.offer : null
    if (!offer?.supported) throw new Error('helper check: the stub reports no supported offer for this window')
    expect(offer.bytes === THIS_PACK.bytes, `the stub offers ${offer.bytes} B, the row's pack ${THIS_PACK.bytes} B: the stub and the row read different platforms`)
    expect(offer.bytes === packBytes(HARNESS_HELPER_PACK), `the stub's offer (${offer.bytes} B) is not the manifest's pack (${packBytes(HARNESS_HELPER_PACK)} B)`)
    saw('absent', { state: editor().helperStatus?.state, reframeHelper: editor().reframe.helper, offerBytes: offer.bytes, kind: offer.kind })

    /* 2. a talk on a 9:16 canvas, selected; the dock's pointer; Settings at the row */
    const fps = editor().project.settings.fps
    const asset: MediaAsset = {
      id: `harness-helper-talk-${Date.now().toString(36)}`,
      path: 'harness://helper-check/talk.webm',
      name: 'helper check talk',
      kind: 'video',
      durationFrames: 10 * fps,
      width: 1280,
      height: 720,
      fps,
      hasVideo: true,
      hasAudio: true,
      size: 1,
      // Offline: the preview loads nothing, and the dock and the pool read only the asset.
      offline: true
    }
    editor().newProject()
    editor().update((p) => ({ ...p, assets: [...p.assets, asset] }))
    editor().addAssetToTimeline(asset.id)
    const clip = editor().project.clips.find((c) => c.assetId === asset.id)
    if (!clip) throw new Error('helper check: the talk did not land on the timeline')
    editor().setAspect('9:16')
    editor().select(clip.id)
    await until(() => document.querySelector('[data-reframe-panel]'), 3000, 'the Trimmer dock showing Follow the subject')
    const pointers = [...reframePanel().querySelectorAll<HTMLButtonElement>('[data-helper-pointer]')]
    const follow = followButton()
    expect(follow.disabled, 'Follow the subject is pressable with no AI helper')
    expect(pointers.length === 1, `the dock has ${pointers.length} "needs the AI helper" pointers, not 1`)
    const pointer = pointers[0]
    expect(norm(pointer?.textContent) === NEEDS_THE_HELPER, `the dock's pointer reads "${norm(pointer?.textContent)}"`)
    expect(pointer?.title === POINTER_TITLE, `the dock's pointer is titled "${pointer?.title}", not "${POINTER_TITLE}"`)
    expect(section() === null, 'Settings was already open before the pointer was pressed')
    // The press asks for the row, and Settings scrolls to it and clears the ask: in a tall window the row is
    // in view whether or not it scrolled, so the ask is watched too (a pointer that only opened Settings).
    const focuses: (string | null)[] = [editor().settingsFocus]
    const unwatch = useEditor.subscribe((state) => {
      if (focuses[focuses.length - 1] !== state.settingsFocus) focuses.push(state.settingsFocus)
    })
    pointer?.click()
    await until(() => editor().settingsOpen && section(), 3000, "Settings opening at the pointer's press")
    await frames()
    unwatch()
    expect(JSON.stringify(focuses) === JSON.stringify([null, 'helper', null]), `the pointer's press asked Settings for ${JSON.stringify(focuses)}, not [null, "helper", null]: the row was not asked for, or never scrolled to`)
    const place = rowPlace()
    expect(place.inView, `the AI helper row is not in view: its top at ${place.rowTop} px, the card's box ${place.boxTop}–${place.boxBottom} px, the window ${place.viewport} px`)
    expect(editor().settingsFocus === null, 'Settings kept its focus request after scrolling to the row')
    const absent = rowSeen()
    const installLabel = `Install the AI helper · ${formatBytes(offerBytes())}`
    const hosts = hostsSentence(offer.bytesOnDisk, offer.hosts)
    expect(absent.text === 'Not installed', `the row reads "${absent.text}", not "Not installed"`)
    expect(absent.dot === 'grey', `Not installed is drawn ${absent.dot}, not grey`)
    expect(JSON.stringify(labels(absent)) === JSON.stringify([installLabel]), `the row offers ${JSON.stringify(labels(absent))}, not ["${installLabel}"]`)
    expect(absent.detail.includes(hosts), `the hosts sentence is not under Install: ${JSON.stringify(absent.detail)}`)
    saw('pointer', { followDisabled: follow.disabled, pointer: norm(pointer?.textContent), title: pointer?.title, focuses, place, row: absent })

    /* 3. Install, slowed so the job can be watched and cancelled mid-download */
    harnessHelper.stepMs = 150
    action('install').click()
    const jobName = helperJobLabel('install')
    const running = await until(() => {
      const seen = jobRow(jobName)
      return seen && seen.speed.startsWith('downloading ·') && Object.keys(harnessHelper.downloaded).length >= 3 ? seen : null
    }, 15_000, 'EXPORT showing the install downloading, three files in')
    const installing = rowSeen()
    expect(running.status === 'running', `EXPORT's row says ${running.status}, not running`)
    expect(installing.text.startsWith('Installing · downloading ·'), `the row reads "${installing.text}" while the job downloads`)
    // An `installing` status offers no press of its own (row.ts); any the row does show waits on the job, saying why.
    expect(installing.buttons.every((b) => b.disabled && b.title === `${jobName} — its bar and its X are in EXPORT`), `the row's presses do not wait on the job: ${JSON.stringify(installing.buttons)}`)
    expect(installing.detail.includes('Its bar and its X are in EXPORT.'), `the row does not send its X to EXPORT: ${JSON.stringify(installing.detail)}`)
    expect(editor().helperStatus?.state === 'installing', `the status is ${editor().helperStatus?.state} while the job runs with no helper up`)
    saw('installing', { exportRow: { name: jobName, status: running.status, speed: running.speed }, row: installing })

    /* 4. the job's X, mid-download: what is left */
    if (!running.cancel) throw new Error('helper check: the running job has no X')
    running.cancel.click()
    const partial = await until(() => {
      const row = section() ? rowSeen() : null
      return row && row.text === 'Not installed' && labels(row)[0]?.endsWith(' left') ? row : null
    }, 5000, 'the row offering what the cancel left')
    const left = harnessHelper.status.state === 'absent' && harnessHelper.status.offer.supported ? harnessHelper.status.offer.bytesLeft : undefined
    const cancelled = jobRow(jobName)
    expect(typeof left === 'number' && left > 0 && left < offer.bytes, `the cancel left ${left} B of ${offer.bytes}`)
    expect(labels(partial)[0] === `Install the AI helper · ${formatBytes(left ?? -1)} left`, `the row's Install reads "${labels(partial)[0]}" after the cancel`)
    expect(cancelled?.status === 'cancelled', `EXPORT's row says ${cancelled?.status} after its X`)
    saw('cancelled', { left, files: Object.keys(harnessHelper.downloaded).length, exportRow: cancelled?.status, row: partial })

    /* 5. Install again: from what was left, every stage in order, to a whole pack */
    harnessHelper.stepMs = 40
    await window.forge.clearFinished()
    await until(() => jobRow(jobName) === null, 3000, 'EXPORT clearing the cancelled job')
    const strip = one('[data-strip="export"]', 'EXPORT strip')
    const record = (): void => {
      const seen = jobRow(jobName)
      if (!seen || !seen.speed || /^\d+%$/.test(seen.speed)) return
      if (report.stages[report.stages.length - 1] !== seen.speed) report.stages.push(seen.speed)
    }
    observer = new MutationObserver(record)
    observer.observe(strip, { subtree: true, childList: true, characterData: true })
    action('install').click()
    await until(() => harnessHelper.status.state === 'ready' && section() && rowSeen().text.startsWith('Running · Python'), 20_000, 'the second install reaching a running helper')
    observer.disconnect()
    observer = null
    await frames()
    const kinds = report.stages
      .map((s) => (s.startsWith('downloading ·') ? 'downloading' : s.startsWith('installing libraries ·') ? 'installing libraries' : s))
      .filter((k, i, all) => i === 0 || all[i - 1] !== k)
    const order = [
      CHECKING_SPACE,
      'downloading',
      UNPACKING_PYTHON,
      'installing libraries',
      CHECKING_STARTING,
      CHECKING_THE_HELPER,
      ...SELFTEST_GROUP_NAMES.map(checkingGroupText)
    ]
    expect(JSON.stringify(kinds) === JSON.stringify(order), `the speed column went ${JSON.stringify(kinds)}, not ${JSON.stringify(order)}`)
    const total = packBytes(HARNESS_HELPER_PACK)
    const firstDownload = report.stages.find((s) => s.startsWith('downloading ·'))
    expect(firstDownload === downloadingText(total - (left ?? 0), total, null), `the second download began at "${firstDownload}", not at what the cancel kept ("${downloadingText(total - (left ?? 0), total, null)}")`)
    const whole = rowSeen()
    const wholeText = `Running · Python ${HELPER_PACK.python.version} · pack ${HELPER_PACK.pack} · ${formatBytes(THIS_PACK.bytesOnDisk)}`
    const repairLabel = `Repair · ${formatBytes(THIS_PACK.bytes)}`
    expect(whole.text === wholeText, `the row reads "${whole.text}", not "${wholeText}"`)
    expect(whole.dot === 'green', `a whole pack is drawn ${whole.dot}`)
    expect(gearDot() === 'green', `the gear's dot is ${gearDot()} beside a whole pack`)
    expect(JSON.stringify(labels(whole)) === JSON.stringify([repairLabel, 'Remove']), `the row offers ${JSON.stringify(labels(whole))}, not ["${repairLabel}","Remove"]`)
    expect(jobRow(jobName)?.status === 'done', `EXPORT's row says ${jobRow(jobName)?.status} after the install`)
    await until(() => editor().reframe.helper === 'ready' && !followButton().disabled, 3000, 'Follow the subject coming on')
    const followAfter = followButton()
    expect(reframePanel().querySelectorAll('[data-helper-pointer]').length === 0, 'the dock still shows its pointer beside a whole pack')
    saw('ready', { python: HELPER_PACK.python.version, pack: HELPER_PACK.pack, row: whole, gear: gearDot(), follow: { disabled: followAfter.disabled, label: norm(followAfter.textContent) } })

    /* 5b. Repair beside the running pack: the helper stays up, every press waits on the job, its X leaves the pack as it was */
    await window.forge.clearFinished()
    harnessHelper.stepMs = 150
    action('repair').click()
    const repairName = helperJobLabel('repair')
    const repairing = await until(() => {
      const seen = jobRow(repairName)
      return seen && seen.speed.startsWith('downloading ·') && section() && rowSeen().text.startsWith('Repairing · downloading ·') ? seen : null
    }, 15_000, 'EXPORT showing the repair downloading')
    const repairRow = rowSeen()
    const waits = `${repairName} — its bar and its X are in EXPORT`
    expect(JSON.stringify(labels(repairRow)) === JSON.stringify([repairLabel, 'Remove']), `while repairing the row shows ${JSON.stringify(labels(repairRow))}, not the pack's presses`)
    expect(repairRow.buttons.every((b) => b.disabled && b.title === waits), `while repairing a press does not wait on the job: ${JSON.stringify(repairRow.buttons)}`)
    expect(editor().helperStatus?.state === 'ready', `a Repair beside a running helper broadcast ${editor().helperStatus?.state}, not ready`)
    expect(!followButton().disabled, 'Follow the subject greyed while a Repair downloads beside the running helper')
    repairing.cancel?.click()
    const repairCancelled = await until(() => {
      const row = section() ? rowSeen() : null
      return row && row.text === wholeText && jobRow(repairName)?.status === 'cancelled' ? row : null
    }, 5000, "the repair's X leaving the pack as it was")
    expect(repairCancelled.buttons.every((b) => !b.disabled), `after the repair's X a press is still waiting: ${JSON.stringify(repairCancelled.buttons)}`)
    harnessHelper.stepMs = 40
    saw('repair', { exportRow: { name: repairName, speed: repairing.speed }, row: repairRow, afterX: repairCancelled })

    /* 6. the Media pool: Transcribe greyed for the speech model, its sized press, then pressable */
    editor().setShelfTool('upload')
    const press = await until(() => document.querySelector<HTMLElement>('[data-speech-press]'), 3000, "the speech model's press over the pool")
    // Read now, as text: the same elements say something else once the press has run.
    const greyed = transcribeButtons().map((b) => ({ title: b.title, disabled: b.disabled }))
    const pressButton = one<HTMLButtonElement>('button', 'button in the speech press', press)
    const speechLabel = speechModelLabel({ bytes: HARNESS_SPEECH_MODEL_BYTES })
    const pressLine = norm(press.querySelector(':scope > span')?.textContent)
    const pressLabel = norm(pressButton.textContent)
    const speechLine = (): string[] =>
      [...(document.querySelector('[data-speech-model]')?.children ?? [])].map((el) => norm(el.textContent))
    const settingsBefore = speechLine()
    expect(greyed.length === 1 && greyed[0].disabled && greyed[0].title === NEEDS_SPEECH_MODEL, `Transcribe is ${JSON.stringify(greyed)}, not greyed "${NEEDS_SPEECH_MODEL}"`)
    expect(pressLine === `Transcribe ${NEEDS_SPEECH_MODEL}`, `the press's line reads "${pressLine}"`)
    expect(pressLabel === speechLabel, `the press reads "${pressLabel}", not "${speechLabel}"`)
    expect(JSON.stringify(settingsBefore) === JSON.stringify(['Speech model', speechLabel]), `Settings' speech model line reads ${JSON.stringify(settingsBefore)}`)
    pressButton.click()
    await until(() => editor().speechModel?.present === true && document.querySelector('[data-speech-press]') === null, 5000, 'the speech model arriving')
    await frames()
    const after = transcribeButtons().map((b) => ({ title: b.title, disabled: b.disabled }))
    expect(after.length === 1 && !after[0].disabled && after[0].title === 'Transcribe', `after the press, Transcribe is ${JSON.stringify(after)}`)
    const settingsAfter = speechLine()
    const onDisk = `Speech model · ${formatBytes(HARNESS_SPEECH_MODEL_BYTES)} · on this machine`
    expect(JSON.stringify(settingsAfter) === JSON.stringify([onDisk]), `after the press Settings' speech model line reads ${JSON.stringify(settingsAfter)}, not ["${onDisk}"]`)
    expect(harnessHelper.presses.some((p) => p.call === 'speechModel' && JSON.stringify(p.options) === '{"download":true}'), 'the press never asked the bridge with download: true')
    saw('speech', { transcribeBefore: greyed, pressLine, press: pressLabel, settingsBefore, transcribeAfter: after, settingsAfter })

    /* 7. a failed beats group: N−1 of N, the runtime's sentence and link, Check again */
    const n = THIS_PACK.expects.length
    const head = HARNESS_BEATS_FAILED.slice(0, HARNESS_BEATS_FAILED.indexOf(' — '))
    const short = await setState('ready-short', `Running · ${n - 1} of ${n}`)
    const shortText = `Running · ${n - 1} of ${n} helper features · ${head}`
    expect(short.text === shortText, `the row reads "${short.text}", not "${shortText}"`)
    expect(short.dot === 'grey', `a pack short of a feature is drawn ${short.dot}`)
    expect(JSON.stringify(labels(short)) === JSON.stringify(['Check again', repairLabel, 'Remove']), `the short pack offers ${JSON.stringify(labels(short))}`)
    expect(short.detail.includes(HARNESS_BEATS_FAILED), `the Visual C++ sentence is not under the presses: ${JSON.stringify(short.detail)}`)
    expect(short.links.includes('https://aka.ms/vs/17/release/vc_redist.x64.exe'), `Microsoft's link is not pressable: ${JSON.stringify(short.links)}`)
    action('checkAgain').click()
    const checked = await until(() => {
      const row = section() ? rowSeen() : null
      return row && row.text === wholeText ? row : null
    }, 5000, 'Check again turning the row green')
    expect(checked.dot === 'green', `after Check again the row is ${checked.dot}`)
    expect(harnessHelper.presses.some((p) => p.call === 'checkHelperAgain'), 'Check again never reached the bridge')
    saw('short', { row: short, afterCheckAgain: checked })

    /* 8. Remove asks, with both sizes, its box off; Remove it; Not installed */
    action('remove').click()
    const confirm = await until(() => document.querySelector('[data-helper-remove]'), 3000, "Remove's question")
    const box = one<HTMLInputElement>('input[type="checkbox"]', "Remove's box", confirm)
    const question = norm(confirm.querySelector('p')?.textContent)
    const asked = `Remove the AI helper? It frees about ${formatBytes(THIS_PACK.bytesOnDisk)}.`
    expect(question === asked, `Remove asks "${question}", not "${asked}"`)
    expect(!box.checked, 'Remove’s "also remove the downloaded models" is ticked before anyone ticked it')
    // The models' size arrives from main after the question opens (store `pressHelper`): the speech model is what step 6 put there.
    const boxText = `also remove the downloaded models · ${formatBytes(HARNESS_SPEECH_MODEL_BYTES)}`
    await until(() => norm(box.parentElement?.textContent) === boxText, 3000, `Remove's box reading "${boxText}" (it reads "${norm(box.parentElement?.textContent)}")`).catch((err: unknown) => {
      failures.push(err instanceof Error ? err.message : String(err))
    })
    const removeIt = [...confirm.querySelectorAll<HTMLButtonElement>('button')].find((b) => norm(b.textContent) === 'Remove it')
    if (!removeIt) throw new Error('helper check: Remove asks with no "Remove it"')
    removeIt.click()
    const removed = await until(() => {
      const row = section() ? rowSeen() : null
      return row && row.text === 'Not installed' && !document.querySelector('[data-helper-remove]') ? row : null
    }, 5000, 'Remove returning the row to Not installed')
    const sent = [...harnessHelper.presses].reverse().find((p) => p.call === 'removeHelper')
    expect(JSON.stringify(sent?.options) === JSON.stringify({ models: false }), `Remove sent ${JSON.stringify(sent?.options)}, not {"models":false}`)
    expect(JSON.stringify(labels(removed)) === JSON.stringify([`Install the AI helper · ${formatBytes(offerBytes())}`]), `after Remove the row offers ${JSON.stringify(labels(removed))}`)
    expect(harnessHelper.speechPresent, 'Remove with the box off took the speech model too')
    saw('remove', { question, box: boxText, boxChecked: box.checked, sent: sent?.options, row: removed })

    /* 9. the other states, as §3a.4's table has them */
    const damaged = await setState('damaged', 'Not running')
    const damagedRepair = `Repair · ${formatBytes(offerBytes())}`
    expect(damaged.text === `Not running · ${HELPER_PYTHON_MISSING}`, `the damaged pack reads "${damaged.text}"`)
    expect(damaged.dot === 'red', `the damaged pack is drawn ${damaged.dot}`)
    expect(JSON.stringify(labels(damaged)) === JSON.stringify([damagedRepair, 'Remove']), `the damaged pack offers ${JSON.stringify(labels(damaged))}`)

    const update = await setState('update', 'Needs an update')
    const updateLabel = `Update the AI helper · ${formatBytes(offerBytes())}`
    expect(update.dot === 'grey', `an older pack is drawn ${update.dot}`)
    expect(JSON.stringify(labels(update)) === JSON.stringify([updateLabel]), `an older pack offers ${JSON.stringify(labels(update))}`)

    const policy = await setState('policy', 'Not running')
    expect(policy.text === `Not running · ${HELPER_BLOCKED_BY_POLICY}`, `a pack Windows' policy refuses reads "${policy.text}"`)
    expect(policy.dot === 'red', `a refused pack is drawn ${policy.dot}`)
    expect(JSON.stringify(labels(policy)) === JSON.stringify([repairLabel, 'Remove']), `a refused pack offers ${JSON.stringify(labels(policy))}`)

    const unsupported = await setState('unsupported', 'Not available on this computer')
    const reason = harnessHelper.status.state === 'absent' && !harnessHelper.status.offer.supported ? harnessHelper.status.offer.reason : '?'
    expect(unsupported.text === `Not available on this computer · ${reason}`, `an unsupported machine reads "${unsupported.text}"`)
    expect(unsupported.buttons.length === 0, `an unsupported machine offers ${JSON.stringify(labels(unsupported))}`)
    expect(unsupported.dot === 'grey', `an unsupported machine is drawn ${unsupported.dot}`)
    saw('states', { damaged, update, policy, unsupported })
  } catch (err) {
    // A step that could not go on: said after what had already failed, which is usually why.
    failures.push(`stopped: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    observer?.disconnect()
    escapeKey()
    harnessHelper.reset()
    await sleep(0)
    useEditor.setState({
      project: kept.project,
      past: kept.past,
      future: kept.future,
      dirty: kept.dirty,
      playhead: kept.playhead,
      selectedClipIds: kept.selectedClipIds,
      selectedClipId: kept.selectedClipId,
      aspect: kept.aspect,
      speechModel: kept.speechModel,
      speechFetch: kept.speechFetch,
      helperUi: kept.helperUi,
      settingsFocus: null
    })
    editor().setHelperStatus(kept.helperStatus)
    editor().setReframeHelper(kept.reframe.helper)
    editor().setReframeModel(kept.reframe.model)
    editor().setSettingsOpen(kept.settingsOpen)
    editor().setExportOpen(kept.exportOpen)
    editor().setShelfTool(kept.shelfTool)
    await sleep(0)
  }

  report.ms = Math.round(performance.now() - started)
  if (failures.length > 0) {
    throw Object.assign(new Error(`helper check: ${failures.length} failed — ${failures.join('; ')}`), { report })
  }
  return report
}

export function installHelperPackCheck(): void {
  ;(window as unknown as { __forgeHelperPackCheck: typeof runHelperPackCheck }).__forgeHelperPackCheck = runHelperPackCheck
}
