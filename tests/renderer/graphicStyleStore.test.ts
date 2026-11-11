import { describe, it, expect, vi } from 'vitest'
import { graphicStyleOf } from '@shared/graphics/style'
import { emptyProject, type GraphicsSettings } from '@shared/timeline'
import { useEditor } from '../../src/renderer/src/store'

/*
 * The graphic style's two store actions (docs/CLIPS.md §6.5), the captions'
 * setters' twins. Here, as tests/renderer/keyStore.test.ts is, because the
 * store is renderer code.
 *
 * Every comparison of what the store wrote is toStrictEqual: toEqual skips a
 * key whose value is undefined, so it would pass a present-but-empty
 * override, the captions' bug (store.ts's setCaptionOverride: the Reset
 * button sat lit over one).
 */

const graphics = (): GraphicsSettings | undefined => useEditor.getState().project.graphics
const history = (): number => useEditor.getState().past.length

function start(settings?: GraphicsSettings): void {
  useEditor.setState({ project: { ...emptyProject(), ...(settings ? { graphics: settings } : {}) }, past: [], future: [] })
}

describe('setGraphicsStyle', () => {
  it('on a project with no graphics: the style, no overrides, sounds on; one undo, which takes it back off', () => {
    start()
    expect(graphics()).toBeUndefined()
    useEditor.getState().setGraphicsStyle('clean')
    expect(graphics()).toStrictEqual({ styleId: 'clean', overrides: {}, sound: true })
    expect(history()).toBe(1)
    useEditor.getState().undo()
    expect(graphics()).toBeUndefined()
  })

  it('keeps the text style and the accent colour and the sounds switch, and drops the rest', () => {
    start({
      styleId: 'clean',
      overrides: { textStyleId: 'outline', 'palette.accent': '#2563EB', radius: 0.05, 'motion.ease': 'linear' },
      sound: false
    })
    useEditor.getState().setGraphicsStyle('bold')
    expect(graphics()).toStrictEqual({
      styleId: 'bold',
      overrides: { textStyleId: 'outline', 'palette.accent': '#2563EB' },
      sound: false
    })
    expect(history()).toBe(1)
  })

  it('keeps only what was there: one kept override does not bring the other in as an empty key', () => {
    start({ styleId: 'clean', overrides: { textStyleId: 'outline', radius: 0.05 }, sound: true })
    useEditor.getState().setGraphicsStyle('bold')
    expect('palette.accent' in (graphics()?.overrides ?? {})).toBe(false)
    expect(graphics()).toStrictEqual({ styleId: 'bold', overrides: { textStyleId: 'outline' }, sound: true })

    start({ styleId: 'clean', overrides: { 'palette.accent': '#2563EB' }, sound: true })
    useEditor.getState().setGraphicsStyle('bold')
    expect('textStyleId' in (graphics()?.overrides ?? {})).toBe(false)
    expect(graphics()).toStrictEqual({ styleId: 'bold', overrides: { 'palette.accent': '#2563EB' }, sound: true })
  })
})

describe('setGraphicsOverride', () => {
  it('writes one key at a time on clean with sounds on, keeps the others, and removes a key set to undefined; one undo each', () => {
    start()
    useEditor.getState().setGraphicsOverride('palette.accent', '#2563EB')
    expect(graphics()).toStrictEqual({ styleId: 'clean', overrides: { 'palette.accent': '#2563EB' }, sound: true })
    useEditor.getState().setGraphicsOverride('radius', 0.05)
    expect(graphics()?.overrides).toStrictEqual({ 'palette.accent': '#2563EB', radius: 0.05 })
    // What the export and the preview will draw with.
    const style = graphicStyleOf(useEditor.getState().project, {})
    expect(style.palette.accent).toBe('#2563EB')
    expect(style.radius).toBe(0.05)

    useEditor.getState().setGraphicsOverride('radius', undefined)
    // Gone, not present-and-empty: the captions' Reset button sat lit over that.
    expect('radius' in (graphics()?.overrides ?? {})).toBe(false)
    expect(graphics()?.overrides).toStrictEqual({ 'palette.accent': '#2563EB' })
    expect(history()).toBe(3)
    useEditor.getState().undo()
    expect(graphics()?.overrides).toStrictEqual({ 'palette.accent': '#2563EB', radius: 0.05 })
  })

  it('leaves the project’s style and its sounds switch alone', () => {
    start({ styleId: 'editorial', overrides: {}, sound: false })
    useEditor.getState().setGraphicsOverride('dim', true)
    expect(graphics()).toStrictEqual({ styleId: 'editorial', overrides: { dim: true }, sound: false })
  })
})

describe('which id wins, the spec’s or the project’s, and the fallback is clean (§6.5, phase 2)', () => {
  it('a spec naming a preset wins over the project’s; a spec naming none takes the project’s; an unknown id on either side is clean, not the other preset', () => {
    start()
    useEditor.getState().setGraphicsStyle('bold')
    const project = useEditor.getState().project
    expect(graphicStyleOf(project, {}).id).toBe('bold')
    expect(graphicStyleOf(project, { style: 'editorial' }).id).toBe('editorial')
    // An unknown id falls back to clean, not to the project's bold.
    expect(graphicStyleOf(project, { style: 'no-such-style' }).id).toBe('clean')
    start({ styleId: 'no-such-style', overrides: {}, sound: true })
    expect(graphicStyleOf(useEditor.getState().project, {}).id).toBe('clean')
    expect(graphicStyleOf(useEditor.getState().project, { style: 'editorial' }).id).toBe('editorial')
    // No graphics at all: clean.
    start()
    expect(graphicStyleOf(useEditor.getState().project, {}).id).toBe('clean')
  })
})

describe('a style change rebakes every graphic clip (§6.5’s UI)', () => {
  it('setGraphicsStyle and setGraphicsOverride each call rebakeGraphic once per graphic clip, and for no other clip', async () => {
    const base = emptyProject()
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id
    const clip = (id: string, graphic: boolean) => ({
      id, assetId: `a-${id}`, trackId, start: 0, duration: 30, inPoint: 0, volume: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      color: { brightness: 0, contrast: 1, saturation: 1 },
      ...(graphic
        ? { graphic: { data: { template: 'counter' as const, value: '5', label: 'x' }, seconds: 1, beats: [0.5], place: { auto: true as const, third: 'bottom' as const }, seed: 1, version: 1 } }
        : {})
    })
    const rebaked: string[] = []
    const rebakeGraphic = async (clipId: string): Promise<void> => {
      rebaked.push(clipId)
    }
    useEditor.setState({ project: { ...base, clips: [clip('g1', true), clip('v1', false), clip('g2', true)] }, past: [], future: [], rebakeGraphic })

    useEditor.getState().setGraphicsStyle('bold')
    await vi.waitFor(() => expect(rebaked).toHaveLength(2))
    expect(rebaked).toEqual(['g1', 'g2'])

    rebaked.length = 0
    useEditor.getState().setGraphicsOverride('palette.accent', '#E11D48')
    await vi.waitFor(() => expect(rebaked).toHaveLength(2))
    expect(rebaked).toEqual(['g1', 'g2'])

  })
})
