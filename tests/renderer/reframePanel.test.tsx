import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProject, type Clip, type MediaAsset } from '@shared/timeline'
import type { Job } from '@shared/types'
import { REFRAME_FAILURES, type ModelStatus } from '@shared/reframe/job'
import { harnessSubjectTrack } from '../../src/renderer/src/harness/reframeStub'

/*
 * The reframe's controls, rendered and pressed (docs/CLIPS.md §4.8): the
 * canvas bar's offer ("Landscape video on a 9:16 canvas", Reframe to 9:16),
 * the Trimmer dock's Follow the subject section, and the job's row in EXPORT.
 *
 * As tests/renderer/ingestPanel.test.tsx does it: rendered to static markup
 * for what is on screen, and — for the presses — the components called as
 * functions, the store mocked to a plain selector over the REAL store's state.
 * The store's reframe actions are slice B's and are replaced here by spies:
 * what is under test is that each control calls the action it stands for, and
 * never another one (Reframe to 9:16 calling setAspect is the bug the plan
 * names).
 */

vi.mock('../../src/renderer/src/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/src/store')>()
  const store = real.useEditor
  const useEditor = Object.assign((select: (s: unknown) => unknown) => select(store.getState()), {
    getState: store.getState,
    setState: store.setState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe
  })
  return { ...real, useEditor }
})
vi.mock('../../src/renderer/src/exportBakers', () => ({ liveBakers: {} }))
vi.mock('../../src/renderer/src/captionBake', () => ({ bakeCaptions: async () => null }))

const { useEditor } = await import('../../src/renderer/src/store')
const { CanvasBar } = await import('../../src/renderer/src/components/CanvasBar')
const { FollowSection, ReframePanel, PHRASE_REASON } = await import('../../src/renderer/src/components/tools/ReframePanel')
const { ExportStrip, jobName } = await import('../../src/renderer/src/components/ExportStrip')

const state = () => useEditor.getState()

/* ------------------------------------------------------------ the walk */

interface Host {
  type: string
  props: Record<string, unknown>
}

/** Every host element a tree comes to, with its props (ingestPanel.test.tsx's walk). */
function hosts(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    for (const child of node) hosts(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  const type = node.type as unknown
  if (typeof type === 'string') {
    out.push({ type, props })
    return hosts(props.children, out)
  }
  if (typeof type === 'function') {
    if ((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) return out
    return hosts((type as (p: unknown) => ReactNode)(props), out)
  }
  const inner = (type as { type?: unknown } | null)?.type
  if (typeof inner === 'function') return hosts((inner as (p: unknown) => ReactNode)(props), out)
  if (typeof type === 'object' && type !== null) return out
  return hosts(props.children, out)
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

const buttons = (all: Host[]): Host[] => all.filter((h) => h.type === 'button')
const named = (all: Host[], label: string): Host | undefined =>
  buttons(all).find((h) => textOf(h.props.children as ReactNode).trim() === label)
const press = (button: Host | undefined, what: string): void => {
  expect(button, what).toBeTruthy()
  ;(button!.props.onClick as () => void)()
}

/** Markup with the tags dropped and entities decoded: the words on screen, in order. */
const words = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/* ------------------------------------------------------------ the scene */

const TALK: MediaAsset = {
  id: 'talk',
  path: 'harness-talk.webm',
  name: 'talk.webm',
  kind: 'video',
  durationFrames: 180,
  width: 640,
  height: 360,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1024
}

const PHOTO = (id: string): MediaAsset => ({
  ...TALK,
  id,
  path: `${id}.jpg`,
  name: `${id}.jpg`,
  kind: 'image',
  width: 1600,
  height: 1067,
  fps: null,
  hasAudio: false
})

const FACE_FINDER: ModelStatus = { present: false, bytes: 1_083_786, label: 'the face finder', host: 'storage.googleapis.com' }

/** A fresh project at `aspect` holding `assets`, with the talk placed once as clip `c-talk`. */
function scene(options: { aspect?: '9:16' | '16:9'; photos?: number; placed?: boolean } = {}): Clip | null {
  const aspect = options.aspect ?? '9:16'
  const photos = Array.from({ length: options.photos ?? 0 }, (_, i) => PHOTO(`photo-${i}`))
  useEditor.setState({ ...useEditor.getInitialState(), project: { ...emptyProject(), assets: [TALK, ...photos] } })
  state().setAspect(aspect)
  if (options.placed === false) return null
  state().addAssetToTimeline(TALK.id)
  const clip = state().project.clips.find((c) => c.assetId === TALK.id)!
  state().update((p) => ({ ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, id: 'c-talk' } : c)) }))
  return state().project.clips.find((c) => c.id === 'c-talk')!
}

/** The talk's clip follows the harness's stub track: shots 0–2/2–4/4–6 s, the third a two-up at 9:16. */
function followed(twoUp?: boolean): void {
  const track = harnessSubjectTrack({ key: `harness:${TALK.path}`, width: 640, height: 360, durationMs: 6000 })
  state().update((p) => ({
    ...p,
    subjects: { ...(p.subjects ?? {}), [TALK.id]: track },
    clips: p.clips.map((c) =>
      c.id === 'c-talk' ? { ...c, follow: { version: 1, ...(twoUp === undefined ? {} : { twoUp }) } } : c
    )
  }))
}

const spies = {
  reframeAll: vi.fn(async () => undefined),
  reframeClip: vi.fn(async (_clipId: string) => undefined),
  unfollow: vi.fn((_clipId: string) => undefined),
  setFollowTwoUp: vi.fn((_clipId: string, _on: boolean) => undefined),
  setAspect: vi.fn((_aspect: string) => undefined)
}

/** The reframe actions (slice B's) as spies, and setAspect watched AFTER the scene was built with the real one. */
function watch(helper: 'ready' | 'missing' | 'unknown' = 'ready', model: ModelStatus | null = { ...FACE_FINDER, present: true }): void {
  for (const spy of Object.values(spies)) spy.mockClear()
  useEditor.setState({
    reframeAll: spies.reframeAll,
    reframeClip: spies.reframeClip,
    unfollow: spies.unfollow,
    setFollowTwoUp: spies.setFollowTwoUp,
    setAspect: spies.setAspect as unknown as ReturnType<typeof state>['setAspect'],
    reframe: { helper, model, fetching: null, pending: {} }
  })
}

beforeEach(() => {
  vi.stubGlobal('window', { forge: { faceModel: async () => ({ ...FACE_FINDER }) } })
})

/* ------------------------------------------------------- the canvas bar */

const bar = (): Host[] => hosts(createElement(CanvasBar))
const barWords = (): string => words(renderToStaticMarkup(createElement(CanvasBar)))

describe('the canvas bar’s reframe offer', () => {
  it('shows "Landscape video on a 9:16 canvas" with Reframe to 9:16 for a landscape talk on a 9:16 canvas', () => {
    scene()
    watch()
    expect(barWords()).toContain('Landscape video on a 9:16 canvas')
    expect(named(bar(), 'Reframe to 9:16'), 'Reframe to 9:16').toBeTruthy()
  })

  it('Reframe to 9:16 calls reframeAll — and never setAspect: the canvas already has the shape', () => {
    scene()
    watch()
    press(named(bar(), 'Reframe to 9:16'), 'Reframe to 9:16')
    expect(spies.reframeAll).toHaveBeenCalledTimes(1)
    expect(spies.setAspect).not.toHaveBeenCalled()
  })

  it('with landscape photos AND a landscape talk on 9:16, the chip shown is the reframe offer', () => {
    scene({ photos: 3 })
    watch()
    const shown = barWords()
    expect(shown).toContain('Landscape video on a 9:16 canvas')
    // One chip slot, one piece of advice: the photo chip's switch is not on screen.
    expect(shown).not.toContain('Switch to')
    expect(shown).not.toContain('Most photos are landscape')
  })

  it('leaves the photo chip to the photos once every landscape clip follows', () => {
    scene({ photos: 3 })
    followed()
    watch()
    const shown = barWords()
    expect(shown).not.toContain('Landscape video on a 9:16 canvas')
    expect(shown).toContain('Most photos are landscape')
    expect(shown).toContain('Switch to 16:9')
  })

  it('does not offer for a talk in the pool but on no clip, nor on a 16:9 canvas', () => {
    scene({ placed: false })
    watch()
    expect(barWords()).not.toContain('Landscape video on')
    scene({ aspect: '16:9' })
    watch()
    expect(barWords()).not.toContain('Landscape video on')
  })

  it('is greyed with "needs the AI helper" without one, and pressing it does nothing', () => {
    scene()
    watch('missing')
    const button = named(bar(), 'Reframe to 9:16')
    expect(button?.props.disabled).toBe(true)
    expect(barWords()).toContain('needs the AI helper')
    scene()
    watch('ready')
    expect(named(bar(), 'Reframe to 9:16')?.props.disabled).toBe(false)
    expect(barWords()).not.toContain('needs the AI helper')
  })

  it('tells the shape buttons’ tooltip that followed clips keep following', () => {
    scene()
    watch()
    const titles = buttons(bar())
      .map((b) => String(b.props.title ?? ''))
      .filter((t) => t.includes('re-solves every clip'))
    expect(titles).toHaveLength(3)
    for (const title of titles) {
      expect(title).toContain("Changing this re-solves every clip's reframe.")
      expect(title.toLowerCase()).toContain('followed clips keep following')
    }
  })
})

/* -------------------------------------------------------------- the dock */

const section = (clipId = 'c-talk'): Host[] => hosts(createElement(FollowSection, { clipId }))
const dockWords = (clipId = 'c-talk'): string => words(renderToStaticMarkup(createElement(ReframePanel, { clipId })))
const followButton = (): Host | undefined =>
  buttons(section()).find((b) => textOf(b.props.children as ReactNode).includes('Follow the subject'))

describe('Follow the subject, in the Trimmer dock', () => {
  it('is greyed with "needs the AI helper" when there is none', () => {
    scene()
    watch('missing', null)
    expect(followButton()?.props.disabled).toBe(true)
    expect(dockWords()).toContain('needs the AI helper')
  })

  it('says "needs the AI helper" only with the Follow button: a clip that already follows keeps following without one', () => {
    scene()
    followed()
    watch('missing', null)
    const shown = dockWords()
    expect(shown).toContain('3 shots · 1 stacked')
    expect(named(section(), 'Unfollow'), 'Unfollow').toBeTruthy()
    expect(followButton()).toBeUndefined()
    expect(shown).not.toContain('needs the AI helper')
    expect(shown).not.toContain('the AI helper is starting')
  })

  it('names the face finder’s size before the first press, and not once it is on disk', () => {
    scene()
    watch('ready', { ...FACE_FINDER, present: false })
    expect(dockWords()).toContain('Follow the subject · gets the face finder, 1.1 MB, first time')
    expect(followButton()?.props.disabled).toBe(false)
    watch('ready', { ...FACE_FINDER, present: true })
    expect(dockWords()).toContain('Follow the subject')
    expect(dockWords()).not.toContain('gets the face finder')
  })

  it('the press follows THIS clip — reframeClip with its id', () => {
    scene()
    watch('ready', { ...FACE_FINDER, present: false })
    press(followButton(), 'Follow the subject')
    expect(spies.reframeClip).toHaveBeenCalledTimes(1)
    expect(spies.reframeClip.mock.calls[0][0]).toBe('c-talk')
    expect(spies.setAspect).not.toHaveBeenCalled()
  })

  it('says it is finding the subject while the file’s analysis runs, and cannot be pressed again', () => {
    scene()
    watch()
    const job = { id: 'job-r', presetId: 'reframe', progress: 0.4, status: 'running' } as Job
    useEditor.setState({ jobs: [job], reframe: { ...state().reframe, pending: { [TALK.id]: 'job-r' } } })
    expect(dockWords()).toContain('Finding the subject… 40%')
    const busy = buttons(section()).find((b) => textOf(b.props.children as ReactNode).includes('Finding the subject'))
    expect(busy?.props.disabled).toBe(true)
  })

  it('on a followed clip: Unfollow, the shots with how many are stacked, Stack two people, and the notes', () => {
    scene()
    followed()
    watch()
    const shown = dockWords()
    expect(shown).toContain('3 shots · 1 stacked')
    expect(shown).toContain('shot 3: two people too far apart, stacked')
    expect(named(section(), 'Unfollow'), 'Unfollow').toBeTruthy()
    expect(named(section(), 'Stack two people')?.props['aria-pressed']).toBe(true)
    // Following, it is not offered again.
    expect(followButton()).toBeUndefined()
  })

  it('Stack two people calls setFollowTwoUp: off from on, on from off', () => {
    scene()
    followed()
    watch()
    press(named(section(), 'Stack two people'), 'Stack two people')
    expect(spies.setFollowTwoUp.mock.calls).toEqual([['c-talk', false]])
    followed(false)
    watch()
    const toggle = named(section(), 'Stack two people')
    expect(toggle?.props['aria-pressed']).toBe(false)
    press(toggle, 'Stack two people')
    expect(spies.setFollowTwoUp.mock.calls).toEqual([['c-talk', true]])
    // With it off, the far-apart shot frames the larger face: no stack.
    expect(dockWords()).not.toContain('stacked,')
    expect(dockWords()).not.toContain('· 1 stacked')
  })

  it('Unfollow calls unfollow with this clip', () => {
    scene()
    followed()
    watch()
    press(named(section(), 'Unfollow'), 'Unfollow')
    expect(spies.unfollow.mock.calls).toEqual([['c-talk']])
  })

  it('has the Follow: field greyed with its reason, in a person’s words', () => {
    scene()
    watch()
    const field = section().find((h) => h.type === 'input')
    expect(field?.props.disabled).toBe(true)
    expect(field?.props.placeholder).toBe('a face')
    const shown = dockWords()
    expect(shown).toContain('Follow:')
    expect(shown).toContain(PHRASE_REASON)
    // One sentence a person reads, the job's own: no step number, and no model nobody can get (§16.35 dropped the subject model).
    expect(PHRASE_REASON).toBe('following something named is not built yet')
    expect(REFRAME_FAILURES['phrase-needs-ground'].toLowerCase()).toContain(PHRASE_REASON)
    expect(shown).not.toMatch(/\b1g\b|subject model/)
  })

  it('is not there for a photo', () => {
    scene({ photos: 1 })
    state().addAssetToTimeline('photo-0')
    const photo = state().project.clips.find((c) => c.assetId === 'photo-0')!
    watch()
    expect(section(photo.id)).toEqual([])
  })

  it('offers neither the salient model nor faceless subjects, in any state (decided 2026-10-13, §16.35)', () => {
    const seen: string[] = []
    for (const helper of ['ready', 'missing'] as const) {
      for (const present of [false, true]) {
        scene()
        watch(helper, { ...FACE_FINDER, present })
        seen.push(dockWords())
        followed()
        watch(helper, { ...FACE_FINDER, present })
        seen.push(dockWords())
      }
    }
    expect(seen).toHaveLength(8)
    for (const shown of seen) {
      expect(shown).toContain('Follow:')
      expect(shown).not.toContain('Get the subject model')
      expect(shown).not.toContain('Find subjects without faces')
    }
  })

  it('is mounted in the dock for a VIDEO clip, under Steady', () => {
    const inspector = readFileSync(resolve(__dirname, '../../src/renderer/src/components/Inspector.tsx'), 'utf8')
    const mount = "{asset?.kind === 'video' && <ReframePanel clipId={clip.id} />}"
    const steady = '{canSteady(clip, asset ?? undefined) && <SteadyToggle clip={clip} />}'
    expect([...inspector.matchAll(/<ReframePanel\b/g)]).toHaveLength(1)
    expect(inspector.split(mount)).toHaveLength(2)
    expect(inspector.split(steady)).toHaveLength(2)
    expect(inspector.indexOf(steady)).toBeLessThan(inspector.indexOf(mount))
  })
})

/* ------------------------------------------------------------ the job row */

describe('the analysis in EXPORT’s list', () => {
  const job = (status: Job['status'], over: Partial<Job> = {}): Job => ({
    id: `job-${status}`,
    presetId: 'reframe',
    input: '/media/talk.mp4',
    inputName: 'talk.mp4',
    output: '',
    params: { assetId: 'talk' },
    status,
    progress: 0.4,
    speed: 'finding faces',
    error: null,
    startedAt: Date.now() - 4000,
    finishedAt: null,
    ...over
  })

  it('reads "Finding the subject · <name>", with its bar, its stage and its cancel', () => {
    scene()
    useEditor.setState({ jobs: [job('running')], exportOpen: true })
    const html = renderToStaticMarkup(createElement(ExportStrip))
    expect(words(html)).toContain('Finding the subject · talk.mp4')
    expect(words(html)).toContain('finding faces')
    // The bar at the job's progress, and the X that cancels it.
    expect(html).toContain('width:40%')
    expect([...html.matchAll(/title="Cancel"/g)]).toHaveLength(1)
    // A render is still named by its file.
    expect(jobName({ presetId: 'render', inputName: 'reel.mp4' })).toBe('reel.mp4')
  })

  it('can be cancelled while it waits its turn, and has no folder to show when done', () => {
    scene()
    useEditor.setState({ jobs: [job('queued', { progress: 0 })], exportOpen: true })
    expect([...renderToStaticMarkup(createElement(ExportStrip)).matchAll(/title="Cancel"/g)]).toHaveLength(1)
    useEditor.setState({ jobs: [job('done', { progress: 1, finishedAt: Date.now() })], exportOpen: true })
    const done = renderToStaticMarkup(createElement(ExportStrip))
    expect(words(done)).toContain('Finding the subject · talk.mp4')
    expect(done).not.toContain('title="Show in folder"')
  })
})
